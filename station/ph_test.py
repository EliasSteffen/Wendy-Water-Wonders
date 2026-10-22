#!/usr/bin/env python3
"""Live test for the DFRobot Gravity analog pH meter V2 on MCP3008 CH2.

Wiring: + -> 3.3 V rail, - -> GND rail, A -> CH2 (chip pin 3). No divider:
the board's output stays within 0-3.0 V.
Two-point calibration with pH 7.0 and pH 4.0 buffers, same maths as DFRobot's
DFRobot_PH library (pH 7 ≈ 1.50 V, pH 4 ≈ 2.03 V before calibration).
"""
import argparse
import statistics
import time

from sensors import ph_from_voltage, read_voltage

DEFAULT_V7 = 1.500
DEFAULT_V4 = 2.032
# DFRobot_PH only accepts buffer readings inside these windows.
V7_RANGE = (1.322, 1.678)
V4_RANGE = (1.854, 2.210)


def label(ph):
    if ph < 6.5:
        return "acidic"
    if ph <= 8.5:
        return "drinking-water range"
    return "alkaline"


def measure(args, seconds=10):
    volts = []
    end = time.time() + seconds
    while time.time() < end:
        volts.append(read_voltage(args.channel, args.samples))
        time.sleep(0.2)
    return statistics.mean(volts)


def calibrate(args):
    input("Probe in pH 7.0 buffer. Wait ~1 min, then press Enter ")
    v7 = measure(args)
    print(f"  pH 7.0 buffer: {v7:.2f} V")
    if not V7_RANGE[0] < v7 < V7_RANGE[1]:
        print(f"  ! Expected {V7_RANGE[0]}–{V7_RANGE[1]} V. Wrong buffer, probe not settled, or wiring?")
    input("Rinse the probe. Probe in pH 4.0 buffer, then press Enter ")
    v4 = measure(args)
    print(f"  pH 4.0 buffer: {v4:.2f} V")
    if not V4_RANGE[0] < v4 < V4_RANGE[1]:
        print(f"  ! Expected {V4_RANGE[0]}–{V4_RANGE[1]} V. Wrong buffer, probe not settled, or wiring?")
    if abs(v4 - v7) < 0.05:
        print("  ! Both buffers read almost the same voltage: is the probe connected and the cap off?")
        return
    print(f"Use from now on:  --v7 {v7:.2f} --v4 {v4:.2f}")


def live(args):
    print(f"pH on MCP3008 CH{args.channel} · v7 = {args.v7:.2f} V · v4 = {args.v4:.2f} V")
    n_read = 0
    while args.count is None or n_read < args.count:
        v = read_voltage(args.channel, args.samples)
        ph, note = ph_from_voltage(v, args.v7, args.v4)
        if note == "no_signal":
            # The board never outputs ~0 V in water, so a pH value here would be meaningless.
            print(f"CH{args.channel} {v:4.2f} V | no signal: is the A wire on CH{args.channel} and the board powered?")
        elif ph is None:
            print(f"CH{args.channel} {v:4.2f} V | {note.replace('_', ' ')}: check --v7 / --v4")
        else:
            print(f"CH{args.channel} {v:4.2f} V | pH {ph:5.2f} | {label(ph)}")
        n_read += 1
        time.sleep(args.interval)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--channel", type=int, default=2, help="MCP3008 channel (default 2)")
    ap.add_argument("--v7", type=float, default=DEFAULT_V7, help="voltage in pH 7.0 buffer (from --calibrate)")
    ap.add_argument("--v4", type=float, default=DEFAULT_V4, help="voltage in pH 4.0 buffer (from --calibrate)")
    ap.add_argument("--samples", type=int, default=25, help="reads per measurement, median is used")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between measurements")
    ap.add_argument("--count", type=int, help="stop after N measurements")
    ap.add_argument("--calibrate", action="store_true", help="two-point calibration with pH 7.0 and pH 4.0 buffers")
    args = ap.parse_args()

    try:
        if args.calibrate:
            calibrate(args)
        else:
            live(args)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
