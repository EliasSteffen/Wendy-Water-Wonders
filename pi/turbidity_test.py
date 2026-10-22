#!/usr/bin/env python3
"""Live test for the turbidity sensor (DFRobot SEN0189-style) on MCP3008 CH1.

Wiring: sensor A/D -> 10k -> node -> CH1, and node -> 20k (or 2x 10k) -> GND.
--ratio undoes the divider: 1.5 for 10k + 20k, 2.0 for 10k + 10k.
"""
import argparse
import statistics
import time

from sensors import read_voltage, turbidity_from_voltage


def label(n, note):
    if note == "no_signal":
        return "no signal"
    if note == "over_range":
        return "very turbid / blocked"
    if n < 50:
        return "clear"
    if n < 500:
        return "slightly turbid"
    if n < 1500:
        return "turbid"
    return "very turbid"


def calibrate(args):
    print("Calibrating: keep the probe in CLEAR water for 10 s ...")
    readings = []
    end = time.time() + 10
    while time.time() < end:
        readings.append(read_voltage(args.channel, args.samples) * args.ratio)
        time.sleep(0.2)
    mean = statistics.mean(readings)
    spread = statistics.pstdev(readings)
    print(f"Clear water: {mean:.3f} V (±{spread:.3f} V, {len(readings)} readings)")
    print(f"Use it from now on with:  --clear {mean:.2f}")


def live(args):
    print(f"Reading MCP3008 CH{args.channel}, divider x{args.ratio}" + (f", clear = {args.clear:.2f} V" if args.clear else ""))
    print("Ctrl+C to stop.\n")
    n_read = 0
    while args.count is None or n_read < args.count:
        v_ch = read_voltage(args.channel, args.samples)
        v = v_ch * args.ratio
        # Same conversion as the uploader, including the clear-water deadband
        n, _, note = turbidity_from_voltage(v_ch, args.ratio, args.clear)
        bar = "#" * max(0, min(30, round(v / 4.5 * 30)))
        if note == "ok":
            ntu_txt = f"{n:7.0f}"
        else:
            ntu_txt = "  >3000" if note == "over_range" else "      -"
        print(f"CH{args.channel} {v_ch:4.2f} V | sensor {v:4.2f} V | ~{ntu_txt} NTU | {bar:<30} {label(n, note)}")
        if v_ch > 3.25:
            print("  ! CH input is at ~3.3 V: clipping. Check the divider before trusting any value.")
        elif v_ch < 0.05:
            print("  ! No signal: switch on 'A'? A/D wire on the divider? Sensor on 5 V?")
        n_read += 1
        time.sleep(args.interval)


def scan(args):
    # Find which channel the sensor is really on: cover the probe gap and watch.
    print("All channels, volts at the MCP3008 input. Cover / uncover the probe gap and see which one moves.\n")
    n_read = 0
    while args.count is None or n_read < args.count:
        vals = [read_voltage(ch, args.samples, delay=0) for ch in range(8)]
        print("  ".join(f"CH{ch} {v:4.2f}" for ch, v in enumerate(vals)))
        n_read += 1
        time.sleep(args.interval)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ratio", type=float, default=1.5, help="divider factor: 1.5 = 10k + 20k (or 10k + 2x10k), 2.0 = 10k + 10k")
    ap.add_argument("--channel", type=int, default=1, help="MCP3008 channel (default 1)")
    ap.add_argument("--samples", type=int, default=25, help="reads per measurement, median is used")
    ap.add_argument("--interval", type=float, default=0.5, help="seconds between measurements")
    ap.add_argument("--count", type=int, help="stop after N measurements")
    ap.add_argument("--clear", type=float, help="sensor voltage measured in clear water (from --calibrate)")
    ap.add_argument("--calibrate", action="store_true", help="measure clear water for 10 s and print the --clear value")
    ap.add_argument("--scan", action="store_true", help="show all 8 channels live to find where the sensor is wired")
    args = ap.parse_args()

    if args.scan:
        try:
            scan(args)
        except KeyboardInterrupt:
            print("\nStopped.")
        return

    try:
        if args.calibrate:
            calibrate(args)
        else:
            live(args)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
