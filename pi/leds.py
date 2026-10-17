#!/usr/bin/env python3
"""Status LEDs of the water station.

  white   on while the station software runs (off = station not working)
  yellow  water is suspicious: probably not drinkable as it is, e.g. boil or chlorinate it first
  red     water is not drinkable, whatever you do (too salty: boiling makes it worse)
  only white = no anomaly measured. That is not a guarantee that the water is safe.

Yellow and red switch on automatically and only ever go up (yellow -> red). Better water
does NOT switch them off: only a person does, with "Reset water" in Wendy's dashboard
(human in the loop). The dashboard puts `reset_water` into the device twin. The warning
is kept in alarm.json, so it survives restarts.

Two sources can raise the warning:
  local  the latest measurement on the Pi, so the LEDs also work offline
         (salt limits as in wendy-azure/functions/logic.py, pH outside 6.5-8.5, turbid water)
  cloud  the cloud's verdict from the device twin (desired.json). Only the cloud knows the
         germ risk (rain, lab tests, type of water source). The cloud raises the warning only
         when its verdict gets worse (none -> yellow -> red), so a verdict a person has reset
         doesn't switch the lights on again by itself.

Wiring (BCM numbers; GPIO -> resistor -> LED long leg, short leg -> GND):
  white   GPIO17 (pin 11)  100 ohm   white LEDs need ~3 V; with 330 ohm they stay almost dark
  yellow  GPIO27 (pin 13)  220 ohm   (330 ohm works too, a bit darker)
  red     GPIO22 (pin 15)  220 ohm
  GND     pin 9 or 14
GPIO 8-11 (SPI0) belong to the MCP3008. Other pins: LED_PINS=white,yellow,red in .env.

Wiring test (each LED lights up for a second; stop the service first, it holds the pins):
    .venv/bin/python leds.py
"""
import argparse
import glob
import json
import os
import threading
import time
import warnings
from datetime import datetime, timezone

LEVELS = ["none", "yellow", "red"]
PINS = (17, 27, 22)            # white, yellow, red

# Local limits. Salt as in the cloud (wendy-azure/functions/logic.py); placeholders until WHH agrees
TDS_YELLOW = 800               # ppm: getting salty
TDS_RED = 1000                 # ppm: too salty for people
PH_OK = (6.5, 8.5)             # WHO range for drinking water
TURBIDITY_YELLOW_NTU = 500     # rough sensor: 500 NTU ≈ 8 % darker than the calibration water


def local_level(m):
    """(level, reason) from one measurement as built by sensors.read_all()."""
    tds, ph, ntu = m.get("tds_ppm"), m.get("ph"), m.get("turbidity_ntu")
    if tds is not None and tds > TDS_RED:
        return "red", f"TDS {tds:.0f} ppm"
    if tds is not None and tds > TDS_YELLOW:
        return "yellow", f"TDS {tds:.0f} ppm"
    if ph is not None and not PH_OK[0] <= ph <= PH_OK[1]:
        return "yellow", f"pH {ph}"
    if ntu is not None and ntu > TURBIDITY_YELLOW_NTU:
        return "yellow", f"turbidity {ntu:.0f} NTU"
    return "none", "measurement ok"


def cloud_level(twin):
    """(level, reason) from the device twin. Salt red = not drinkable at all;
    a germ risk means "treat before drinking", so it is yellow, never red.
    Older cloud versions only send `use`, then salt is derived from it."""
    salt = twin.get("salt") or {"none": "red", "livestock_only": "red",
                                "people_caution": "yellow"}.get(twin.get("use"), "none")
    germs = twin.get("germs") or "none"
    if salt == "red":
        return "red", f"cloud: {twin.get('use')}"
    if germs != "none":
        return "yellow", f"cloud: germ risk {germs}"
    if salt == "yellow":
        return "yellow", "cloud: salt elevated or rising"
    return "none", "cloud: no anomaly"


def header_pin_factory():
    """lgpio pin factory for the 40-pin header. On the Pi 5 that is the gpiochip labelled
    pinctrl-rp1; recent kernels number it gpiochip15 instead of 0/4, where gpiozero looks
    by default ("can not open gpiochip"). Returns None to let gpiozero choose."""
    try:
        import lgpio
        from gpiozero.pins.lgpio import LGPIOFactory, LGPIOPin
    except ImportError:
        return None

    class ChipFactory(LGPIOFactory):
        # gpiozero 2.0.1 ignores LGPIOFactory(chip=...) and always opens chip 0 or 4
        def __init__(self, chip):
            super(LGPIOFactory, self).__init__()
            self._handle = lgpio.gpiochip_open(chip)
            self._chip = chip
            self.pin_class = LGPIOPin

    for path in sorted(glob.glob("/dev/gpiochip*")):
        chip = int(path[len("/dev/gpiochip"):])
        try:
            handle = lgpio.gpiochip_open(chip)
        except lgpio.error:
            continue
        try:
            label = lgpio.gpio_get_chip_info(handle)[3]
        finally:
            lgpio.gpiochip_close(handle)
        if label == "pinctrl-rp1":
            return ChipFactory(chip)
    return None


class StatusLeds:
    def __init__(self, pins=PINS, log=print, state_file=None):
        try:
            from gpiozero.exc import PinFactoryFallback
            warnings.simplefilter("ignore", PinFactoryFallback)
        except ImportError:
            pass
        from gpiozero import LED
        factory = header_pin_factory()
        self.white, self.yellow, self.red = (LED(p, pin_factory=factory) for p in pins)
        self.log, self.state_file, self._lock = log, state_file, threading.Lock()
        # cloud_seen: the cloud's last verdict level, so only a worse one raises the warning
        self._state = {"level": "none", "reason": "", "since": None, "cloud_seen": "none", "reset_ack": None}
        try:
            with open(state_file, encoding="utf-8") as f:
                self._state.update(json.load(f))
        except (TypeError, OSError, ValueError):
            pass
        self.white.on()
        self._show()
        if self._state["level"] != "none":
            log(f"LED {self._state['level']} kept from before ({self._state['reason']}, "
                f"since {self._state['since']}): waiting for 'Reset water' in the dashboard")

    def update_local(self, measurement):
        with self._lock:
            self._raise(*local_level(measurement))

    def update_cloud(self, twin):
        """Called with the whole device twin after every change. A new `reset_water` from the
        dashboard clears the warning; a cloud verdict raises it only when it got worse.
        (The cloud re-sends the same verdict with a new timestamp, e.g. while it still
        remembers an old salty reading; that must not undo a person's reset.)"""
        reset = twin.get("reset_water") or {}
        level, reason = cloud_level(twin)
        with self._lock:
            if reset.get("id") and reset["id"] != self._state["reset_ack"]:
                self._reset(reset)          # the person saw the cloud's current verdict
            elif LEVELS.index(level) > LEVELS.index(self._state["cloud_seen"]):
                self._raise(level, reason)
            if level != self._state["cloud_seen"]:
                self._state["cloud_seen"] = level
                self._save()

    def _reset(self, reset):
        """Switch yellow/red off. New bad measurements and a cloud verdict that gets worse
        switch the warning on again."""
        who = f"{reset.get('by') or 'someone'} in the dashboard"
        self._state = {"level": "none", "reason": f"reset by {who}", "since": _now(),
                       "cloud_seen": self._state["cloud_seen"], "reset_ack": reset["id"]}
        self._save()
        self._show()
        self.log(f"LED warning cleared by {who}")

    def _raise(self, level, reason):
        if LEVELS.index(level) <= LEVELS.index(self._state["level"]):
            return                          # only up; going down needs "Reset water" in the dashboard
        self._state.update(level=level, reason=reason, since=_now())
        self._save()
        self._show()
        self.log(f"LED {level} ({reason}), stays on until 'Reset water' in the dashboard")

    def _save(self):
        if not self.state_file:
            return
        tmp = self.state_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._state, f, indent=2)
        os.replace(tmp, self.state_file)    # atomic: a power cut can't leave half a file

    def _show(self):
        level = self._state["level"]
        (self.yellow.on if level == "yellow" else self.yellow.off)()
        (self.red.on if level == "red" else self.red.off)()

    def off(self):
        for led in (self.white, self.yellow, self.red):
            led.off()


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    ap = argparse.ArgumentParser(description="LED wiring test: white, yellow, red one after another")
    ap.add_argument("--pins", default=os.environ.get("LED_PINS", ",".join(map(str, PINS))),
                    help="GPIO numbers white,yellow,red (default 17,27,22)")
    args = ap.parse_args()
    leds = StatusLeds(tuple(int(p) for p in args.pins.split(",")))
    leds.white.off()
    try:
        for name, led in (("white", leds.white), ("yellow", leds.yellow), ("red", leds.red)):
            print(f"{name} on (GPIO{led.pin.number})")
            led.on()
            time.sleep(1)
            led.off()
    finally:
        leds.off()


if __name__ == "__main__":
    main()
