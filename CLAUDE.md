# CLAUDE.md

Hackathon project (BCG Platinion · Fighting World Hunger): a water-quality station.
A Raspberry Pi 5 reads three analog water sensors (TDS, turbidity, pH) through an MCP3008 ADC.
The station code in `station/` runs on the Pi and uploads to Azure; the cloud side (Functions, risk logic, dashboard) is in `cloud/`.

## Repo layout

| Path | What |
|---|---|
| `station/` | Python that runs **on the Pi** (deployed to `~/water-quality/`): `sensors.py` (all conversions), `uploader.py`, `leds.py`, systemd unit |
| `station/tds_test.py` | TDS sensor: live readings and calibration (CH0) |
| `station/turbidity_test.py` | Turbidity sensor: live readings (CH1); `--scan` shows all 8 ADC channels |
| `station/ph_test.py` | pH sensor: live readings and two-point calibration (CH2) |
| `cloud/` | Azure Functions: ingest, risk logic (`logic.py`), forecast, dashboard (`static/map.html`) |
| `simulator/` | Simulates the other 13 water points for the demo |
| `analysis/turkana-map/` | Map of water points and cell towers in Turkana |
| `animations/` | Remotion videos of the wiring |

## The Pi

- SSH with your laptop on the same network as the Pi: `ssh user@raspberrypi.local`, or add a host alias to `~/.ssh/config`. Below, `<pi>` stands for that SSH host.
- Wi-Fi only (no Ethernet). NetworkManager has two profiles: the venue network (priority 0) and a phone hotspot (priority 10, preferred whenever the Pi reconnects). The IP depends on the network, so use `raspberrypi.local` instead of a fixed address.
- Raspberry Pi OS (Debian 12 bookworm), Python 3.11, aarch64. The clock is NTP-synced (Europe/Berlin); send timestamps in UTC.
- SPI is enabled. User `user` is in the `gpio` and `spi` groups. `gpiozero` and `spidev` come from apt.
- Scripts live in `~/water-quality/`. Deploy from the repo root: `scp station/*.py <pi>:~/water-quality/`
- System Python is externally managed (PEP 668), so `pip install` outside a venv fails. Create the venv **with system site packages** so the apt-installed `gpiozero`/`spidev` stay importable:
  ```bash
  python3 -m venv --system-site-packages ~/water-quality/.venv
  ~/water-quality/.venv/bin/pip install azure-iot-device
  ```
  Done: `azure-iot-device` 2.14.0 is installed in `~/water-quality/.venv`.

## Hardware

| Sensor | Board pins | Wired to | ADC channel | Output |
|---|---|---|---|---|
| TDS (CQRobot TDS Meter) | `+` / `−` / `A` | 3.3 V rail / GND / CH0 directly | **0** | 0–2.3 V, no divider |
| Turbidity (DFRobot-style "Turbidity sensor v1.0") | `+` / `−` / `A/D` | Pi pin 2 (5 V) / GND / voltage divider → CH1 | **1** | up to 4.5 V, divided down before the ADC |
| pH (DFRobot Gravity Analog pH Meter V2.0, BNC probe) | `+` / `−` / `A` | 3.3 V rail / GND / CH2 directly (chip pin 3) | **2** | 0–3.0 V, no divider |

MCP3008 on SPI0 CE0 (`/dev/spidev0.0`), VDD = VREF = 3.3 V, 10-bit.
`gpiozero.MCP3008(channel=n).value` returns 0.0–1.0; multiply by 3.3 for the voltage at the ADC pin.
Don't change channels, divider ratio or VREF in code without checking the breadboard.

## Converting readings

All conversions live in `station/sensors.py`; the test scripts and the uploader import them. Don't copy the formulas.

TDS (DFRobot GravityTDS method):
```
ec_raw = 133.42·V³ − 255.86·V² + 857.39·V
ec25   = ec_raw · k / (1 + 0.02·(T − 25))   # k = 1.0 unless calibrated, T = water temperature in °C
tds    = ec25 · 0.5                          # ppm; ec25 is in µS/cm
```

Turbidity:
```
V_sensor = V_adc · ratio                     # ratio 1.5 (10k + 20k) or 2.0 (10k + 10k): check the breadboard
NTU      = −1120.4·V² + 5742.3·V − 4352.9    # valid only for 2.5–4.2 V; ≥ 4.2 V → 0 NTU, < 2.5 V → "> 3000"
```

pH (two-point calibration, same maths as DFRobot's `DFRobot_PH` library):
```
pH = 7 + (V − V7) · 3 / (V7 − V4)            # V7/V4 = voltage in pH 7.0 / pH 4.0 buffer
                                             # defaults 1.500 / 2.032 V; real values come from `ph_test.py --calibrate`
```

Take the median of ~25 reads per measurement. NTU is a rough estimate; the trend matters more than the absolute number.
Probes in the same water can disturb each other (the TDS board drives an AC current through the water). If pH jumps when the TDS probe is in the same glass, read the sensors one after another or use an analog signal isolator.

## Status at the end of the hackathon (2026-10-17)

- MCP3008 and SPI respond (CH0 jumpered to GND read 0.0).
- TDS: `tds_test.py` works; CH0 reads ≈ 0 V until the probe is in water.
- Turbidity: **working and calibrated** (2026-10-17). Divider 10 kΩ + 10 kΩ → `TURBIDITY_DIVIDER_RATIO=2.0`. This sensor gives only ~2.0 V in clear tap water (not the 4.2 V of DFRobot's formula), so `uploader.py --calibrate-turbidity` stores the clear-water voltage as `TURBIDITY_CLEAR_V` (2.009 V) and readings are scaled to it; up to 5 % darker still counts as 0 NTU, LED yellow from 500 NTU (~8 % darker). The probe is an open infrared light barrier: room light moves the reading (jumps of ~20 % seen), so use an opaque cup and recalibrate on site. `TURBIDITY_ENABLED=1`. Earlier "floating CH1" diagnosis was wrong: CH1 is driven, the sensor output itself was changing. Code must handle missing or implausible values: send `null`, never crash.
- Uploader: `sensors.py` + `uploader.py` + `leds.py` from `station/` are deployed to `~/water-quality/`; `.env` exists, real upload to IoT Hub works (cloud answered `livestock_only` for salty water on 2026-10-16). The systemd service `water-uploader` is installed but **not enabled at boot**: the user starts and stops it manually (`sudo systemctl start|stop water-uploader`). Don't enable it. pH calibration goes into `.env` as `PH_V7` / `PH_V4`.
- Status LEDs (`leds.py`): white GPIO17 (100 Ω), yellow GPIO27 (220 Ω), red GPIO22 (220 Ω), wired and driven by the service. Yellow/red latch (kept in `~/water-quality/alarm.json`) and are only cleared by a person via "Station lights → Reset water" in the dashboard (`POST /api/reset` → twin `reset_water`). No other reset path on purpose (human in the loop).
- Function App with `/api/reset`, the dashboard section and `salt`/`germs` in the twin is deployed (Maxi, 2026-10-17; first dashboard reset at 01:03). The cloud raises the LEDs only when its verdict gets worse (`cloud_seen` in `alarm.json`); before that fix the same verdict re-sent with a new timestamp undid the reset. The cloud still remembers wp07's last valid salt (1169 ppm from a salt test) until the TDS probe measures real water again.
- pH: added to the wiring plan (CH2) and `ph_test.py` is on the Pi; not calibrated yet. Calibration values (`--v7`, `--v4`) must be stored somewhere the uploader can read them (config file or env), not hard-coded.
- The warning `PinFactoryFallback: Falling back from lgpio` is harmless for SPI; the scripts silence it. Cause: on this kernel (6.12) the 40-pin header is `/dev/gpiochip15` (label `pinctrl-rp1`), there is no gpiochip0/4, and gpiozero 2.0.1 ignores `LGPIOFactory(chip=...)`. GPIO outputs (LEDs) therefore need the workaround in `leds.py` (`header_pin_factory()`).

## Azure

- Payload, offline buffer, LEDs and all options: `station/README.md`. Cloud setup, risk logic and alerts: `cloud/README.md`.
- The device connection string is read from `IOTHUB_DEVICE_CONNECTION_STRING` in `~/water-quality/.env` on the Pi. **Never commit it.**

## Conventions

- Python 3.11, standard library plus `gpiozero` and `azure-iot-device`. Small CLI scripts with `argparse`, English comments, matching the style of the existing `station/` scripts.
- Always test on the real Pi, e.g. `ssh <pi> 'cd ~/water-quality && .venv/bin/python uploader.py --dry-run --count 3'`.
