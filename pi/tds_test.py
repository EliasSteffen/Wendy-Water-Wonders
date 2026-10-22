#!/usr/bin/env python3
"""Live test for the CQRobot TDS meter on MCP3008 CH0.

Wiring: + -> 3.3 V rail, - -> GND rail, A -> CH0 (chip pin 1). No divider:
the board's output stays below 2.3 V.
Conversion follows DFRobot's GravityTDS library: EC from a cubic fit,
2 %/°C temperature compensation to 25 °C, TDS = EC / 2.
"""
import argparse
import statistics
import time

from sensors import TDS_FACTOR, raw_ec, read_voltage, tds_from_voltage

BOARD_MAX_V = 2.3


def label(ppm):
    # WHO palatability bands for drinking water.
    if ppm < 10:
        return "dry probe / pure water"
    if ppm < 300:
        return "excellent"
    if ppm < 600:
        return "good"
    if ppm < 900:
        return "fair"
    if ppm < 1200:
        return "poor"
    return "unacceptable"


def calibrate(args):
    print(f"Calibrating: probe in a {args.calibrate:.0f} ppm solution at {args.temp:.1f} °C, 10 s ...")
    volts = []
    end = time.time() + 10
    while time.time() < end:
        volts.append(read_voltage(args.channel, args.samples))
        time.sleep(0.2)
    v = statistics.mean(volts)
    if raw_ec(v) <= 0:
        print(f"Reading is {v:.3f} V, too low to calibrate. Is the probe in the solution?")
        return
    expected_raw_ec = args.calibrate / TDS_FACTOR * (1 + 0.02 * (args.temp - 25))
    k = expected_raw_ec / raw_ec(v)
    print(f"Average {v:.3f} V -> k = {k:.2f}")
    if not 0.25 < k < 4.0:
        print("k is outside 0.25–4.0: check the solution value, the wiring and the probe.")
    print(f"Use it from now on with:  --k {k:.2f}")


def live(args):
    print(f"TDS on MCP3008 CH{args.channel} · {args.temp:.1f} °C · k = {args.k:.2f}")
    n_read = 0
    while args.count is None or n_read < args.count:
        v = read_voltage(args.channel, args.samples)
        ec, ppm = tds_from_voltage(v, args.temp, args.k)
        ec, ppm = ec or 0.0, ppm or 0.0  # None: probe not in water
        print(f"CH{args.channel} {v:4.2f} V | TDS {ppm:4.0f} ppm | EC {ec:4.0f} µS/cm | {label(ppm)}")
        if v > BOARD_MAX_V + 0.1:
            print(f"  ! Above the board's {BOARD_MAX_V} V maximum: is the TDS A wire really on CH0?")
        n_read += 1
        time.sleep(args.interval)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--channel", type=int, default=0, help="MCP3008 channel (default 0)")
    ap.add_argument("--temp", type=float, default=25.0, help="water temperature in °C (default 25)")
    ap.add_argument("--k", type=float, default=1.0, help="probe factor from --calibrate (default 1.0)")
    ap.add_argument("--samples", type=int, default=25, help="reads per measurement, median is used")
    ap.add_argument("--interval", type=float, default=1.0, help="seconds between measurements")
    ap.add_argument("--count", type=int, help="stop after N measurements")
    ap.add_argument("--calibrate", type=float, metavar="PPM", help="calibrate in a solution of known ppm (e.g. 707)")
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
