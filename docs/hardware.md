# Hardware

The station is a Raspberry Pi 5 with three analog water sensors read through an MCP3008 ADC, plus three status LEDs.
Software and setup on the Pi: [`pi/README.md`](../pi/README.md).

## Parts

| Part | Model used | Qty | Notes |
|---|---|---|---|
| Single-board computer | Raspberry Pi 5 | 1 | Any RAM size; Raspberry Pi OS (Debian 12), Python 3.11 |
| ADC | MCP3008 (10-bit, 8 channels, SPI, DIP-16) | 1 | The Pi has no analog inputs |
| Salt (TDS / conductivity) | CQRobot TDS Meter | 1 | 0–1000 ppm range, outputs at most ~2.3 V (≈ 1100 ppm) |
| Turbidity | DFRobot-style "Turbidity sensor v1.0" | 1 | **Only the bottom of the probe is waterproof.** Needs 5 V |
| pH | DFRobot Gravity Analog pH Meter V2.0 with BNC probe | 1 | Needs pH 7.0 and pH 4.0 buffer solutions for calibration |
| Resistors for the turbidity divider | 10 kΩ + 10 kΩ (or 10 kΩ + 20 kΩ) | 2 | Brings the sensor's 4.5 V down below 3.3 V |
| Status LEDs | white, yellow, red | 3 | With 100 Ω (white) and 2 × 220 Ω resistors |
| Breadboard, jumper wires, Pi 5 power supply | | | |
| Opaque cup or container | | 1 | Room light shifts the turbidity reading |

## Wiring

MCP3008 on SPI0 CE0 (`/dev/spidev0.0`), VDD = VREF = 3.3 V. Don't change channels, divider ratio or VREF in code without checking the breadboard.

| MCP3008 pin | Signal | Connects to |
|---|---|---|
| 1 | CH0 | TDS board `A` |
| 2 | CH1 | Turbidity divider midpoint |
| 3 | CH2 | pH board `A` |
| 9 | DGND | GND |
| 10 | CS | Pi pin 24 (GPIO8, CE0) |
| 11 | DIN | Pi pin 19 (GPIO10, MOSI) |
| 12 | DOUT | Pi pin 21 (GPIO9, MISO) |
| 13 | CLK | Pi pin 23 (GPIO11, SCLK) |
| 14 | AGND | GND |
| 15 | VREF | 3.3 V |
| 16 | VDD | 3.3 V |

| Sensor | Board pins | Wired to | ADC channel | Output |
|---|---|---|---|---|
| TDS | `+` / `−` / `A` | 3.3 V / GND / CH0 directly | 0 | 0–2.3 V, no divider |
| Turbidity | `+` / `−` / `A/D` | Pi pin 2 (5 V) / GND / divider → CH1 | 1 | up to 4.5 V, divided before the ADC |
| pH | `+` / `−` / `A` | 3.3 V / GND / CH2 directly | 2 | 0–3.0 V, no divider |

**Turbidity divider:** sensor `A/D` → 10 kΩ → midpoint → CH1, and midpoint → 10 kΩ (or 20 kΩ) → GND.
The code undoes it with `TURBIDITY_DIVIDER_RATIO`: 2.0 for 10 kΩ + 10 kΩ, 1.5 for 10 kΩ + 20 kΩ.

**LEDs** (BCM numbers; GPIO → resistor → long leg, short leg → GND):

| LED | GPIO | Pi pin | Resistor |
|---|---|---|---|
| white | 17 | 11 | 100 Ω (white needs ~3 V; with 330 Ω it stays almost dark) |
| yellow | 27 | 13 | 220 Ω |
| red | 22 | 15 | 220 Ω |
| GND | | 9 or 14 | |

The [animations](../animations/) show the wiring step by step.

## From voltage to values

All conversions live in [`pi/sensors.py`](../pi/sensors.py). Each measurement is the median of ~25 reads.

TDS (DFRobot GravityTDS method):
```
ec_raw = 133.42·V³ − 255.86·V² + 857.39·V
ec25   = ec_raw · k / (1 + 0.02·(T − 25))   # k = calibration factor, T = water temperature in °C
tds    = ec25 · 0.5                          # ppm; ec25 in µS/cm
```

Turbidity (DFRobot curve, valid for 2.5–4.2 V at the sensor):
```
V_sensor = V_adc · ratio
NTU      = −1120.4·V² + 5742.3·V − 4352.9    # ≥ 4.2 V → 0 NTU, < 2.5 V → "> 3000"
```
Our sensor gave only ~2.0 V in clear water instead of 4.2 V, so readings are scaled to a clear-water calibration (see below). Up to 5 % darker than the calibration water still counts as clear. NTU is a rough estimate: the trend matters more than the absolute number.

pH (two-point calibration, same maths as DFRobot's `DFRobot_PH`):
```
pH = 7 + (V − V7) · 3 / (V7 − V4)            # V7 / V4 = voltage in pH 7.0 / pH 4.0 buffer
```

## Calibration

Run these on the Pi in `~/water-quality/` and put the results into `.env`:

| Sensor | Command | Goes into `.env` |
|---|---|---|
| TDS | `python3 tds_test.py --calibrate 707` (probe in a solution of known ppm, here 707) | `TDS_K` |
| Turbidity | `.venv/bin/python uploader.py --calibrate-turbidity` (clear water, no bubbles, opaque cup) | `TURBIDITY_CLEAR_V` (written automatically) |
| pH | `python3 ph_test.py --calibrate` (pH 7.0 buffer, rinse, pH 4.0 buffer) | `PH_V7`, `PH_V4` |

Until pH is calibrated it is sent as `null` with `ph_note: "not_calibrated"`; the raw voltage is always sent.

## Lessons learned

- **Probes disturb each other.** The TDS board drives an AC current through the water; the pH reading can jump when both probes are in the same glass. `sensors.read_all()` reads the sensors one after another; an analog signal isolator would be cleaner.
- **The turbidity probe is an open infrared light barrier.** Room light moved the reading by up to ~20 %. Measure in an opaque container and recalibrate on site.
- **TDS range:** the probe tops out at ~1100 ppm. That is enough for the 800 ppm "too salty for people" limit, but not for very salty water.
- **Pi 5 GPIO quirk:** on kernel 6.12 the 40-pin header is `/dev/gpiochip15` (`pinctrl-rp1`) and gpiozero 2.0.1 doesn't find it. SPI still works; the LEDs need the workaround in `leds.py` (`header_pin_factory()`). The warning `PinFactoryFallback` is harmless for SPI.
- **Python on Raspberry Pi OS is externally managed (PEP 668):** create the venv with `--system-site-packages` so the apt-installed `gpiozero` and `spidev` stay importable.
- **Event Wi-Fi often blocks MQTT port 8883.** Use a phone hotspot or `IOTHUB_WEBSOCKETS=1` (port 443).
