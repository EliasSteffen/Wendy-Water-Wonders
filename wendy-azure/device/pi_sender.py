#!/usr/bin/env python3
"""Store-and-forward sender for the Raspberry Pi at the water point.

- reads one JSON line per measurement from the Arduino over USB serial
  (or fakes readings with --fake)
- stores every reading in a local SQLite buffer (works offline)
- whenever the IoT Hub is reachable (e.g. Wendy's phone hotspot), uploads
  all unsent readings in one message and marks them as sent
- receives the device twin (nearest alternative, advice, forecast) and
  writes it to desired.json for the local display code

Setup on the Pi:
    pip install azure-iot-device pyserial
    export IOTHUB_DEVICE_CONN="HostName=...;DeviceId=wp07;SharedAccessKey=..."
    python pi_sender.py --serial /dev/ttyACM0      # or: --fake
    # event WiFi blocks port 8883? add --websockets (uses port 443)
"""
import argparse
import json
import os
import random
import socket
import sqlite3
import time
from datetime import datetime, timezone

from azure.iot.device import IoTHubDeviceClient, Message

CONN = os.environ["IOTHUB_DEVICE_CONN"]
PARTS = dict(p.split("=", 1) for p in CONN.split(";") if p)
HOST, DEVICE_ID = PARTS["HostName"], PARTS["DeviceId"]
POINT_ID = os.environ.get("POINT_ID", DEVICE_ID)
DB_PATH = os.environ.get("BUFFER_DB", "buffer.db")
TWIN_FILE = os.environ.get("TWIN_FILE", "desired.json")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ buffer --
db = sqlite3.connect(DB_PATH)
db.execute("CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY, payload TEXT, sent INTEGER DEFAULT 0)")
db.commit()


def store(reading):
    db.execute("INSERT INTO readings (payload) VALUES (?)", (json.dumps(reading),))
    db.commit()


def unsent(limit=200):
    return db.execute("SELECT id, payload FROM readings WHERE sent = 0 ORDER BY id LIMIT ?", (limit,)).fetchall()


def mark_sent(ids):
    db.executemany("UPDATE readings SET sent = 1 WHERE id = ?", [(i,) for i in ids])
    db.commit()


# ------------------------------------------------------------------- twin ---
def save_desired(patch):
    try:
        with open(TWIN_FILE, encoding="utf-8") as f:
            cur = json.load(f)
    except (OSError, ValueError):
        cur = {}
    cur.update({k: v for k, v in patch.items() if not k.startswith("$")})
    with open(TWIN_FILE, "w", encoding="utf-8") as f:
        json.dump(cur, f, indent=2)
    print("twin update:", cur.get("alternative"), cur.get("use"))


# ------------------------------------------------------------- connection ---
client = None
USE_WEBSOCKETS = False   # --websockets: MQTT over port 443 if 8883 is blocked


def hub_reachable():
    try:
        socket.create_connection((HOST, 443 if USE_WEBSOCKETS else 8883), timeout=3).close()
        return True
    except OSError:
        return False


def ensure_client():
    global client
    if client is None:
        client = IoTHubDeviceClient.create_from_connection_string(
            CONN, connection_retry=False, websockets=USE_WEBSOCKETS)
        client.connect()
        client.on_twin_desired_properties_patch_received = save_desired
        save_desired(client.get_twin().get("desired", {}))
    return client


def drop_client():
    global client
    try:
        if client:
            client.shutdown()
    except Exception:
        pass
    client = None


def flush():
    rows = unsent()
    if not rows or not hub_reachable():
        return 0
    try:
        c = ensure_client()
        msg = Message(json.dumps({"readings": [json.loads(p) for _, p in rows]}))
        msg.content_type = "application/json"
        msg.content_encoding = "utf-8"
        c.send_message(msg)
        mark_sent([i for i, _ in rows])
        return len(rows)
    except Exception as e:
        print("upload failed, keeping buffer:", e)
        drop_client()
        return 0


# --------------------------------------------------------------- readings ---
def serial_readings(port):
    import serial
    ser = serial.Serial(port, 9600, timeout=2)
    while True:
        line = ser.readline().decode(errors="ignore").strip()
        if line.startswith("{"):
            try:
                yield json.loads(line)
            except ValueError:
                pass
        else:
            yield None


def fake_readings():
    while True:
        yield {"turb_ntu": round(random.uniform(1.5, 2.5), 2),
               "ec_us": round(random.uniform(620, 680)),
               "temp_c": round(random.uniform(28, 32), 1),
               "visits": random.randint(0, 2)}
        time.sleep(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serial", help="e.g. /dev/ttyACM0")
    ap.add_argument("--fake", action="store_true")
    ap.add_argument("--interval", type=float, default=10, help="seconds between stored readings")
    ap.add_argument("--websockets", action="store_true", help="use port 443 (if 8883 is blocked)")
    a = ap.parse_args()
    global USE_WEBSOCKETS
    USE_WEBSOCKETS = a.websockets
    source = fake_readings() if a.fake or not a.serial else serial_readings(a.serial)

    last_store = last_flush = 0.0
    latest, visits = None, 0
    for r in source:
        if r:
            latest = r
            visits += int(r.get("visits", 0))
        t = time.time()
        if latest and t - last_store >= a.interval:
            reading = {**latest, "visits": visits, "point_id": POINT_ID, "ts": now_iso()}
            store(reading)
            print("stored", reading)
            visits, last_store = 0, t
        if t - last_flush >= 15:
            n = flush()
            if n:
                print(f"uploaded {n} buffered readings")
            last_flush = t


if __name__ == "__main__":
    main()
