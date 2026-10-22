#!/usr/bin/env python3
"""Reads the water sensors and sends the measurements to Azure IoT Hub.

- one measurement every --interval seconds (default 30, INTERVAL_S in .env),
  median of 25 ADC reads per sensor
- every measurement goes into a local SQLite buffer (buffer.db) first and is
  deleted only after the IoT Hub has acknowledged it, so nothing is lost when
  Wi-Fi drops. A background thread uploads the oldest measurements in batches
  whenever the hub is reachable, so measuring never waits for the network
- receives the device twin from the cloud (nearest alternative water point,
  advice, forecast) and writes it to desired.json

Secrets: IOTHUB_DEVICE_CONNECTION_STRING from ~/water-quality/.env (never commit it).

Test first:
    .venv/bin/python uploader.py --dry-run --count 3
    .venv/bin/python uploader.py --fake --dry-run --count 3      # without sensors
Run:
    .venv/bin/python uploader.py
    .venv/bin/python uploader.py --interval 5                    # faster, e.g. for the demo

Status LEDs (white = running, yellow = suspicious, red = not drinkable): see leds.py.
Yellow/red stay on until someone clicks "Reset water" in Wendy's dashboard (via the device twin).
"""
import argparse
import json
import os
import random
import signal
import socket
import sqlite3
import sys
import threading
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
TWIN_FILE = os.path.join(HERE, "desired.json")
ALARM_FILE = os.path.join(HERE, "alarm.json")    # LED warning, kept until "Reset water" in the dashboard
SEND_TIMEOUT_S = 60      # give up on one upload attempt after this; the SDK call has no timeout of its own
RETRY_S = 30             # after a failed upload, retry with the next measurement or after this long
DRAIN_AT_EXIT_S = 30     # with --count: how long to wait for the last upload before exiting


def load_env(path=os.path.join(HERE, ".env")):
    """Minimal .env reader (KEY=VALUE per line), no extra dependency."""
    if not os.path.exists(path):
        return
    # utf-8-sig: Windows Notepad may save with a BOM, which would break the first key
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env_float(name, default=None):
    """Float from the environment; missing or empty -> default."""
    value = os.environ.get(name, "").strip()
    return float(value) if value else default


def set_env(key, value, path=os.path.join(HERE, ".env")):
    """Set KEY=value in .env: replace that line or append it, keep everything else."""
    try:
        with open(path, encoding="utf-8-sig") as f:
            lines = f.read().splitlines()
    except OSError:
        lines = []
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("#") and line.split("=", 1)[0].strip() == key:
            lines[i] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(tmp, 0o600)                            # .env holds the connection string
    os.replace(tmp, path)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(*parts):
    print(datetime.now().strftime("%H:%M:%S"), *parts, flush=True)


# ------------------------------------------------------------------ buffer --
class Buffer:
    """Measurements waiting for upload. A row is deleted only after the IoT Hub
    acknowledged it. sqlite3 connections belong to one thread, so the measuring
    and the upload thread each open their own Buffer on the same file."""

    def __init__(self, path):
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")      # one thread writes while the other reads
        self.db.execute("PRAGMA synchronous=FULL")      # survive power cuts on the SD card
        self.db.execute("CREATE TABLE IF NOT EXISTS readings "
                        "(id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL)")
        self.db.commit()

    def add(self, payload, max_rows):
        """Store one measurement. Returns how many of the oldest rows were dropped
        because the buffer is full (only happens after a very long offline period)."""
        with self.db:
            self.db.execute("INSERT INTO readings (payload) VALUES (?)", (json.dumps(payload),))
            return self.db.execute("DELETE FROM readings WHERE id <= (SELECT MAX(id) FROM readings) - ?",
                                   (max_rows,)).rowcount

    def oldest(self, limit):
        return self.db.execute("SELECT id, payload FROM readings ORDER BY id LIMIT ?", (limit,)).fetchall()

    def delete(self, ids):
        with self.db:
            self.db.executemany("DELETE FROM readings WHERE id = ?", [(i,) for i in ids])

    def pending(self):
        return self.db.execute("SELECT COUNT(*) FROM readings").fetchone()[0]


# ---------------------------------------------------------------- IoT Hub --
class Uploader:
    def __init__(self, conn_str, websockets=False, twin_file=TWIN_FILE, on_twin=None):
        parts = dict(p.split("=", 1) for p in conn_str.split(";") if "=" in p)
        if "HostName" not in parts or "DeviceId" not in parts:
            raise ValueError("IOTHUB_DEVICE_CONNECTION_STRING looks wrong (needs HostName=...;DeviceId=...)")
        self.conn_str, self.host, self.device_id = conn_str, parts["HostName"], parts["DeviceId"]
        self.websockets, self.twin_file, self.client = websockets, twin_file, None
        self.on_twin = on_twin              # called with the whole twin after every update (LEDs)

    def reachable(self):
        try:
            socket.create_connection((self.host, 443 if self.websockets else 8883), timeout=3).close()
            return True
        except OSError:
            return False

    def _save_twin(self, patch):
        try:
            with open(self.twin_file, encoding="utf-8") as f:
                cur = json.load(f)
        except (OSError, ValueError):
            cur = {}
        if "use" in patch and "salt" not in patch:
            # Sent by older cloud code without salt/germs: don't mix it with a stale salt/germs
            cur.pop("salt", None)
            cur.pop("germs", None)
        cur.update({k: v for k, v in patch.items() if not k.startswith("$")})
        with open(self.twin_file, "w", encoding="utf-8") as f:
            json.dump(cur, f, indent=2)
        alt = cur.get("alternative") or {}
        # salt/germs as sent in this update ("-" = not sent, e.g. by older cloud code)
        log("cloud says:", cur.get("use"), "| salt", patch.get("salt", "-"), "| germs", patch.get("germs", "-"),
            "| alternative:", alt.get("id"), alt.get("km"))
        if self.on_twin:
            try:
                self.on_twin(cur)
            except Exception as e:
                log("LED update failed:", e)

    def _connect(self):
        from azure.iot.device import IoTHubDeviceClient
        self.client = IoTHubDeviceClient.create_from_connection_string(
            self.conn_str, connection_retry=False, websockets=self.websockets)
        self.client.connect()
        try:
            self.client.on_twin_desired_properties_patch_received = self._save_twin
            self._save_twin(self.client.get_twin().get("desired", {}))
        except Exception as e:
            log("could not read the device twin, uploading anyway:", e)

    def _drop(self):
        """Forget the client. shutdown() runs in the background so a dead connection can't block us."""
        client, self.client = self.client, None

        def shutdown():
            try:
                client.shutdown()
            except Exception:
                pass

        if client:
            threading.Thread(target=shutdown, daemon=True).start()

    def send(self, payloads):
        """Send one batch and wait until the IoT Hub acknowledged it.
        Returns True only if the hub confirmed it; never raises."""
        result = {}

        def attempt():
            try:
                from azure.iot.device import Message
                if self.client is None:
                    self._connect()
                msg = Message(json.dumps({"readings": payloads}))
                msg.content_type = "application/json"
                msg.content_encoding = "utf-8"
                self.client.send_message(msg)       # returns only after the hub's acknowledgement
                result["ok"] = True
            except Exception as e:
                result["error"] = e

        worker = threading.Thread(target=attempt, daemon=True)
        worker.start()
        worker.join(SEND_TIMEOUT_S)
        if result.get("ok"):
            return True
        log("upload failed, keeping buffer:", result.get("error") or f"no answer within {SEND_TIMEOUT_S}s")
        self._drop()
        return False


def upload_loop(uploader, buffer_path, batch, new_data):
    """Background thread: send the oldest measurements until the buffer is empty.
    Each batch is deleted only after the IoT Hub acknowledged it; if the upload
    breaks off in between, the batch is sent again (the cloud overwrites duplicates)."""
    buffer = Buffer(buffer_path)
    offline = False
    while True:
        try:
            rows = buffer.oldest(batch)
            if rows and not uploader.reachable():
                if not offline:
                    log("offline, measurements stay in buffer.db")
                offline = True
            elif rows and uploader.send([json.loads(p) for _, p in rows]):
                buffer.delete([i for i, _ in rows])
                log(f"sent {len(rows)} · {buffer.pending()} waiting")
                offline = False
                continue                            # more waiting? send them right away
        except Exception as e:                      # e.g. SQLite busy: never stop uploading for good
            log("upload error:", e)
        new_data.wait(RETRY_S)                      # wake up with the next measurement
        new_data.clear()


# --------------------------------------------------------------- measuring --
def measure(args):
    if args.fake:
        ec = round(random.uniform(520, 600), 1)
        return {"tds_v": 0.7, "ec_us_cm": ec, "tds_ppm": round(ec * 0.5, 1),
                "turbidity_v": None, "turbidity_ntu": None, "turbidity_note": "fake",
                "ph_v": None, "ph": round(random.uniform(7.0, 7.6), 2), "ph_note": "fake",
                "water_temp_c": args.temp}
    import sensors
    m = sensors.read_all(samples=args.samples, ratio=args.ratio, temp_c=args.temp, k=args.k,
                         ph_v7=args.ph_v7, ph_v4=args.ph_v4, turb_clear_v=args.turbidity_clear_v)
    if not args.turbidity:
        m["turbidity_ntu"], m["turbidity_note"] = None, "disabled"
    return m


def calibrate_turbidity(args, seconds=30):
    """Clear-water reference for the turbidity sensor. Probe in clear water (no bubbles,
    best in an opaque cup: room light shifts the reading), then run --calibrate-turbidity.
    Saves the sensor voltage as TURBIDITY_CLEAR_V in .env if the reading is stable."""
    import statistics
    import sensors
    log(f"turbidity calibration: probe in clear water, don't touch it ({seconds} s)")
    vals = []
    end = time.time() + seconds
    while time.time() < end:
        vals.append(sensors.read_voltage(sensors.TURBIDITY_CHANNEL, args.samples) * args.ratio)
        time.sleep(0.5)
    clear_v, low, high = statistics.median(vals), min(vals), max(vals)
    log(f"sensor in clear water: {clear_v:.3f} V (min {low:.3f}, max {high:.3f}, ratio {args.ratio:g})")
    if clear_v < 0.5:
        sys.exit("almost no signal: is the sensor powered and the probe in the water?")
    if high - low > sensors.TURBIDITY_CLEAR_DEADBAND * clear_v:
        sys.exit("not stable (spread over 5 %): shade the cup, remove bubbles, don't touch, run again")
    set_env("TURBIDITY_CLEAR_V", f"{clear_v:.3f}")
    log("saved TURBIDITY_CLEAR_V in .env. If the service runs: sudo systemctl restart water-uploader")


def start_leds(args):
    """Status LEDs (leds.py). Never fatal: without them the station still measures."""
    if args.no_leds:
        return None
    try:
        import leds
        status = leds.StatusLeds(tuple(int(p) for p in args.led_pins.split(",")), log=log,
                                 state_file=ALARM_FILE)
    except Exception as e:
        log("no status LEDs:", e)
        return None
    try:
        with open(TWIN_FILE, encoding="utf-8") as f:
            status.update_cloud(json.load(f))           # last cloud verdict, also when offline
    except (OSError, ValueError):
        pass
    return status


def main():
    load_env()
    ap = argparse.ArgumentParser(description="Send water sensor readings to Azure IoT Hub")
    ap.add_argument("--interval", type=float, default=env_float("INTERVAL_S", 30.0),
                    help="seconds between measurements (default 30, or INTERVAL_S in .env)")
    ap.add_argument("--count", type=int, default=0, help="stop after N measurements (0 = run forever)")
    ap.add_argument("--dry-run", action="store_true", help="print the JSON instead of sending it")
    ap.add_argument("--fake", action="store_true", help="fake sensor values (no hardware needed)")
    ap.add_argument("--samples", type=int, default=25, help="ADC reads per measurement (median)")
    ap.add_argument("--ratio", type=float, default=env_float("TURBIDITY_DIVIDER_RATIO", 1.5),
                    help="turbidity voltage divider: 1.5 (10k+20k) or 2.0 (10k+10k), check the breadboard")
    ap.add_argument("--k", type=float, default=env_float("TDS_K", 1.0), help="TDS calibration factor")
    ap.add_argument("--temp", type=float, default=env_float("WATER_TEMP_C", 25.0),
                    help="water temperature in °C for TDS compensation (no temp sensor yet)")
    ap.add_argument("--ph-v7", type=float, default=env_float("PH_V7"),
                    help="voltage in pH 7.0 buffer (from ph_test.py --calibrate); without it pH is sent as null")
    ap.add_argument("--ph-v4", type=float, default=env_float("PH_V4"),
                    help="voltage in pH 4.0 buffer (from ph_test.py --calibrate)")
    ap.add_argument("--point-id", default=os.environ.get("POINT_ID", "wp07"),
                    help="water point this station represents on Wendy's map")
    ap.add_argument("--websockets", action="store_true",
                    default=os.environ.get("IOTHUB_WEBSOCKETS", "") == "1",
                    help="use port 443 if the network blocks MQTT port 8883")
    ap.add_argument("--batch", type=int, default=int(env_float("UPLOAD_BATCH", 100)),
                    help="measurements per upload message (default 100)")
    ap.add_argument("--max-rows", type=int, default=int(env_float("MAX_BUFFER_ROWS", 200000)),
                    help="buffer limit; beyond it the oldest measurements are dropped (200000 ≈ 70 days at 30 s)")
    ap.add_argument("--no-turbidity", dest="turbidity", action="store_false",
                    default=os.environ.get("TURBIDITY_ENABLED", "1") != "0",
                    help="send turbidity as null while the sensor isn't wired right (TURBIDITY_ENABLED=0)")
    ap.add_argument("--turbidity-clear-v", type=float, default=env_float("TURBIDITY_CLEAR_V"),
                    help="turbidity sensor voltage in clear water (set by --calibrate-turbidity)")
    ap.add_argument("--calibrate-turbidity", action="store_true",
                    help="measure clear water for 30 s and save TURBIDITY_CLEAR_V in .env, then exit")
    ap.add_argument("--led-pins", default=os.environ.get("LED_PINS", "17,27,22"),
                    help="GPIO numbers of the white, yellow, red LED (default 17,27,22)")
    ap.add_argument("--no-leds", action="store_true", help="don't use the status LEDs")
    args = ap.parse_args()
    if args.calibrate_turbidity:
        return calibrate_turbidity(args)

    # systemctl stop sends SIGTERM: exit through the finally below, so the LEDs go dark
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    status = start_leds(args)
    try:
        run(args, status)
    finally:
        if status:
            status.off()


def run(args, status):
    uploader = buffer = None
    if not args.dry_run:
        conn = os.environ.get("IOTHUB_DEVICE_CONNECTION_STRING")
        if not conn:
            sys.exit("IOTHUB_DEVICE_CONNECTION_STRING missing: put it into ~/water-quality/.env")
        uploader = Uploader(conn, websockets=args.websockets, on_twin=status and status.update_cloud)
        buffer_path = os.path.join(HERE, "buffer.db")
        buffer = Buffer(buffer_path)
        new_data = threading.Event()
        threading.Thread(target=upload_loop, args=(uploader, buffer_path, args.batch, new_data),
                         name="upload", daemon=True).start()
    device_id = uploader.device_id if uploader else "dry-run"

    log(f"station {args.point_id} ({device_id}) · every {args.interval:g}s · "
        f"{'DRY RUN' if args.dry_run else 'sending to Azure'}")
    n = 0
    while True:
        started = time.time()
        payload = {"deviceId": device_id, "point_id": args.point_id, "ts": now_iso(), **measure(args)}
        if status:
            status.update_local(payload)

        if args.dry_run:
            print(json.dumps(payload), flush=True)
        else:
            dropped = buffer.add(payload, args.max_rows)
            new_data.set()
            if dropped:
                log(f"buffer full, dropped the {dropped} oldest measurements")
            log(f"measured · TDS {payload['tds_ppm']} ppm · pH {payload['ph']} · "
                f"NTU {payload['turbidity_ntu']} · {buffer.pending()} waiting")

        n += 1
        if args.count and n >= args.count:
            break
        time.sleep(max(0.0, args.interval - (time.time() - started)))

    if buffer:
        # --count run: give the upload thread a moment for the last measurements
        deadline = time.time() + DRAIN_AT_EXIT_S
        while buffer.pending() and time.time() < deadline:
            time.sleep(1)
        if buffer.pending():
            log(f"{buffer.pending()} measurements stay in buffer.db for the next run")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
