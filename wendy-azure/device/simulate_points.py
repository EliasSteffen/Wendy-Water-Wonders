#!/usr/bin/env python3
"""Simulates the 13 water points that have no real hardware.

Sends one batched message for all simulated points every few seconds.
Type commands while it runs to trigger demo events:

    salt wp03     conductivity climbs step by step (salinity rising); "well03" works too
    dirt wp11     turbidity jumps (dirty water)
    clear wp03    back to normal
    clear all     everything back to normal

Setup:
    pip install azure-iot-device
    export IOTHUB_SIM_CONN="HostName=...;DeviceId=sim;SharedAccessKey=..."
    python simulate_points.py
"""
import json
import os
import random
import threading
import time
from datetime import datetime, timezone

from azure.iot.device import IoTHubDeviceClient, Message

HERE = os.path.dirname(os.path.abspath(__file__))
POINTS_FILE = os.environ.get("POINTS_FILE", os.path.join(HERE, "..", "functions", "points.json"))
REAL = set(os.environ.get("REAL_DEVICE_IDS", "wp07").split(","))
INTERVAL = float(os.environ.get("SIM_INTERVAL", "5"))

with open(POINTS_FILE, encoding="utf-8") as f:
    POINTS = [p for p in json.load(f) if p["id"] not in REAL]

events = {p["id"]: {"ec_factor": 1.0, "salt": False, "turb_factor": 1.0} for p in POINTS}


def commands():
    while True:
        try:
            cmd = input().strip().split()
        except EOFError:
            return
        if len(cmd) != 2:
            print("commands: salt <id> | dirt <id> | clear <id> | clear all")
            continue
        action, pid = cmd[0], cmd[1].replace("well", "wp", 1)   # "salt well03" works too
        targets = list(events) if pid == "all" else [pid]
        for t in targets:
            if t not in events:
                print("unknown point", t)
                continue
            if action == "salt":
                events[t]["salt"] = True
            elif action == "dirt":
                events[t]["turb_factor"] = 5.0
            elif action == "clear":
                events[t] = {"ec_factor": 1.0, "salt": False, "turb_factor": 1.0}
        print("ok:", action, pid)


def reading(p):
    ev = events[p["id"]]
    if ev["salt"]:
        ev["ec_factor"] = min(ev["ec_factor"] * 1.12, 4.0)   # climbs over ~1 minute
    ev["turb_factor"] = max(1.0, ev["turb_factor"] * 0.97)    # dirt slowly settles
    return {
        "point_id": p["id"],
        "ts": datetime.now(timezone.utc).isoformat(),
        "ec_us": round(p["baseline_ec"] * ev["ec_factor"] * random.uniform(0.98, 1.02)),
        "turb_ntu": round(p["baseline_turb"] * ev["turb_factor"] * random.uniform(0.9, 1.1), 2),
        "temp_c": round(random.uniform(27, 33), 1),
        "visits": random.randint(0, 3),
    }


def main():
    client = IoTHubDeviceClient.create_from_connection_string(os.environ["IOTHUB_SIM_CONN"])
    client.connect()
    threading.Thread(target=commands, daemon=True).start()
    print(f"simulating {len(POINTS)} points every {INTERVAL}s. Commands: salt/dirt/clear <id>")
    while True:
        msg = Message(json.dumps({"readings": [reading(p) for p in POINTS]}))
        msg.content_type = "application/json"
        msg.content_encoding = "utf-8"
        client.send_message(msg)
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
