#!/usr/bin/env python3
"""Reads the water sensors and sends the measurements to Azure IoT Hub.

- one measurement every --interval seconds (median of 25 ADC reads per sensor)
- every measurement is stored in a local SQLite buffer first, so nothing is
  lost when Wi-Fi drops; unsent measurements are uploaded in one batch as soon
  as the IoT Hub is reachable again
- receives the device twin from the cloud (nearest alternative water point,
  advice, forecast) and writes it to desired.json

Secrets: IOTHUB_DEVICE_CONNECTION_STRING from ~/water-quality/.env (never commit it).

Test first:
    .venv/bin/python uploader.py --dry-run --count 3
    .venv/bin/python uploader.py --fake --dry-run --count 3      # without sensors
Run:
    .venv/bin/python uploader.py
"""
import argparse
import json
import os
import random
import socket
import sqlite3
import sys
import time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))


def load_env(path=os.path.join(HERE, ".env")):
    """Minimal .env reader (KEY=VALUE per line), no extra dependency."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(*parts):
    print(datetime.now().strftime("%H:%M:%S"), *parts, flush=True)


# ------------------------------------------------------------------ buffer --
class Buffer:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS readings "
                        "(id INTEGER PRIMARY KEY, payload TEXT, sent INTEGER DEFAULT 0)")
        self.db.commit()

    def add(self, payload):
        self.db.execute("INSERT INTO readings (payload) VALUES (?)", (json.dumps(payload),))
        self.db.commit()

    def unsent(self, limit=200):
        return self.db.execute("SELECT id, payload FROM readings WHERE sent = 0 ORDER BY id LIMIT ?",
                               (limit,)).fetchall()

    def mark_sent(self, ids):
        self.db.executemany("UPDATE readings SET sent = 1 WHERE id = ?", [(i,) for i in ids])
        self.db.commit()

    def pending(self):
        return self.db.execute("SELECT COUNT(*) FROM readings WHERE sent = 0").fetchone()[0]


# ---------------------------------------------------------------- IoT Hub --
class Uploader:
    def __init__(self, conn_str, websockets=False, twin_file=os.path.join(HERE, "desired.json")):
        parts = dict(p.split("=", 1) for p in conn_str.split(";") if "=" in p)
        if "HostName" not in parts or "DeviceId" not in parts:
            raise ValueError("IOTHUB_DEVICE_CONNECTION_STRING looks wrong (needs HostName=...;DeviceId=...)")
        self.conn_str, self.host, self.device_id = conn_str, parts["HostName"], parts["DeviceId"]
        self.websockets, self.twin_file, self.client = websockets, twin_file, None

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
        cur.update({k: v for k, v in patch.items() if not k.startswith("$")})
        with open(self.twin_file, "w", encoding="utf-8") as f:
            json.dump(cur, f, indent=2)
        alt = cur.get("alternative") or {}
        log("cloud says:", cur.get("use"), "| alternative:", alt.get("id"), alt.get("km"))

    def _connect(self):
        from azure.iot.device import IoTHubDeviceClient
        self.client = IoTHubDeviceClient.create_from_connection_string(
            self.conn_str, connection_retry=False, websockets=self.websockets)
        self.client.connect()
        self.client.on_twin_desired_properties_patch_received = self._save_twin
        self._save_twin(self.client.get_twin().get("desired", {}))

    def _drop(self):
        try:
            if self.client:
                self.client.shutdown()
        except Exception:
            pass
        self.client = None

    def send(self, payloads):
        """Send a batch. Returns True on success; never raises."""
        from azure.iot.device import Message
        try:
            if self.client is None:
                self._connect()
            msg = Message(json.dumps({"readings": payloads}))
            msg.content_type = "application/json"
            msg.content_encoding = "utf-8"
            self.client.send_message(msg)
            return True
        except Exception as e:
            log("upload failed, keeping buffer:", e)
            self._drop()
            return False


# --------------------------------------------------------------- measuring --
def measure(args):
    if args.fake:
        ec = round(random.uniform(520, 600), 1)
        return {"tds_v": 0.7, "ec_us_cm": ec, "tds_ppm": round(ec * 0.5, 1),
                "turbidity_v": None, "turbidity_ntu": None, "turbidity_note": "fake",
                "water_temp_c": args.temp}
    import sensors
    return sensors.read_all(samples=args.samples, ratio=args.ratio, temp_c=args.temp, k=args.k)


def main():
    load_env()
    ap = argparse.ArgumentParser(description="Send water sensor readings to Azure IoT Hub")
    ap.add_argument("--interval", type=float, default=float(os.environ.get("INTERVAL_S", 30)),
                    help="seconds between measurements (default 30)")
    ap.add_argument("--count", type=int, default=0, help="stop after N measurements (0 = run forever)")
    ap.add_argument("--dry-run", action="store_true", help="print the JSON instead of sending it")
    ap.add_argument("--fake", action="store_true", help="fake sensor values (no hardware needed)")
    ap.add_argument("--samples", type=int, default=25, help="ADC reads per measurement (median)")
    ap.add_argument("--ratio", type=float, default=float(os.environ.get("TURBIDITY_DIVIDER_RATIO", 1.5)),
                    help="turbidity voltage divider: 1.5 (10k+20k) or 2.0 (10k+10k), check the breadboard")
    ap.add_argument("--k", type=float, default=float(os.environ.get("TDS_K", 1.0)), help="TDS calibration factor")
    ap.add_argument("--temp", type=float, default=float(os.environ.get("WATER_TEMP_C", 25.0)),
                    help="water temperature in °C for TDS compensation (no temp sensor yet)")
    ap.add_argument("--point-id", default=os.environ.get("POINT_ID", "wp07"),
                    help="water point this station represents on Wendy's map")
    ap.add_argument("--websockets", action="store_true",
                    default=os.environ.get("IOTHUB_WEBSOCKETS", "") == "1",
                    help="use port 443 if the network blocks MQTT port 8883")
    args = ap.parse_args()

    uploader = None
    if not args.dry_run:
        conn = os.environ.get("IOTHUB_DEVICE_CONNECTION_STRING")
        if not conn:
            sys.exit("IOTHUB_DEVICE_CONNECTION_STRING missing: put it into ~/water-quality/.env")
        uploader = Uploader(conn, websockets=args.websockets)
    device_id = uploader.device_id if uploader else "dry-run"
    buffer = Buffer(os.path.join(HERE, "buffer.db"))

    log(f"station {args.point_id} ({device_id}) · every {args.interval:.0f}s · "
        f"{'DRY RUN' if args.dry_run else 'sending to Azure'}")
    n = 0
    while True:
        started = time.time()
        payload = {"deviceId": device_id, "point_id": args.point_id, "ts": now_iso(), **measure(args)}

        if args.dry_run:
            print(json.dumps(payload), flush=True)
        else:
            buffer.add(payload)
            rows = buffer.unsent()
            if uploader.reachable():
                if uploader.send([json.loads(p) for _, p in rows]):
                    buffer.mark_sent([i for i, _ in rows])
                    log(f"sent {len(rows)} · TDS {payload['tds_ppm']} ppm · NTU {payload['turbidity_ntu']}")
            else:
                log(f"offline, buffered ({buffer.pending()} waiting) · TDS {payload['tds_ppm']} ppm")

        n += 1
        if args.count and n >= args.count:
            break
        time.sleep(max(0.0, args.interval - (time.time() - started)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
