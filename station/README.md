# Pi: water sensors → Azure IoT Hub

Raspberry Pi 5 + MCP3008 (TDS on CH0, turbidity on CH1, pH on CH2). Wiring, parts and calibration: [`../docs/hardware.md`](../docs/hardware.md).

| File | What |
|---|---|
| `sensors.py` | Shared sensor code: median ADC reads, TDS, turbidity and pH conversion. Everything else imports it; don't copy the formulas |
| `tds_test.py` / `turbidity_test.py` / `ph_test.py` | Live readings and calibration per sensor, for wiring and testing. `turbidity_test.py --scan` shows all 8 ADC channels |
| `uploader.py` | Measures every 30 s (configurable), buffers in SQLite, uploads to Azure IoT Hub, deletes what the hub acknowledged, receives the device twin, drives the LEDs |
| `leds.py` | Status LEDs white / yellow / red; `python leds.py` is the wiring test |
| `.env.example` | Template for `~/water-quality/.env` (connection string, pH calibration, interval) |
| `water-uploader.service` | systemd unit to start the uploader on boot |

## Setup on the Pi (once)

```bash
# from the repo root on your laptop; <pi> is the Pi's SSH host, e.g. user@raspberrypi.local
scp station/*.py station/.env.example station/water-uploader.service <pi>:~/water-quality/

ssh <pi>
cd ~/water-quality
python3 -m venv --system-site-packages .venv      # keeps apt's gpiozero/spidev importable
.venv/bin/pip install azure-iot-device
cp .env.example .env && nano .env                  # paste the connection string for device wp07
```

The connection string comes from Azure. It is a password, so never commit it:
`az iot hub device-identity connection-string show -n <your-hub> -d wp07 -o tsv`

Turbidity: the divider is 10 kΩ + 10 kΩ, so `TURBIDITY_DIVIDER_RATIO=2.0`. Every sensor gives a different voltage in clear water, so calibrate once (and again on site): probe in clear water, no bubbles, ideally in an opaque cup (room light shifts the reading), then `.venv/bin/python uploader.py --calibrate-turbidity`. It measures for 30 s and saves `TURBIDITY_CLEAR_V` in `.env` only if the reading is stable. Clear water then reads 0 NTU; up to 5 % darker still counts as clear. Set `TURBIDITY_ENABLED=1` and restart the service.

pH: run `python3 ph_test.py --calibrate` with pH 7.0 and pH 4.0 buffers and put the two voltages into `.env` as `PH_V7` / `PH_V4`. Until then pH is sent as `null` (with `ph_note: "not_calibrated"`); the raw voltage `ph_v` is always sent.

## Test

```bash
.venv/bin/python uploader.py --dry-run --count 3          # real sensors, prints JSON, sends nothing
.venv/bin/python uploader.py --count 3 --interval 10      # real upload, 3 measurements
```

Expected: `measured · TDS 281.0 ppm · pH 7.1 · NTU None · 1 waiting`, then `sent 1 · 0 waiting`. On Wendy's map (`/api/map`) water point **wp07** gets real values within a minute.

Turbidity sends `null` while CH1 has no signal; the cloud keeps working with TDS only.

## Run in the background

The service is installed but does not start at boot: start and stop it yourself.

```bash
sudo cp water-uploader.service /etc/systemd/system/ && sudo systemctl daemon-reload   # once
sudo systemctl start water-uploader                       # start
sudo systemctl stop water-uploader                        # stop (LEDs go dark)
journalctl -u water-uploader -f                           # live log
```

To start it at every boot instead: `sudo systemctl enable water-uploader`.

## Demo: measure faster

Needs the setup above first (`.env` with the connection string, service installed).

The default is one measurement every 30 s. To change it, edit `INTERVAL_S` in `~/water-quality/.env` and restart:

```bash
ssh <pi>
sed -i 's/^INTERVAL_S=.*/INTERVAL_S=5/' ~/water-quality/.env
sudo systemctl restart water-uploader
journalctl -u water-uploader -f                           # check: "every 5s"
```

The IoT Hub runs on the S1 tier (400,000 messages per day), so even one measurement per second (86,400) fits. If the quota ever runs out, uploads fail and the measurements simply stay in the buffer until the next day.

Without the service, for a quick try: `sudo systemctl stop water-uploader`, then `.venv/bin/python uploader.py --interval 5`.

## Options

| Flag / .env | Default | Meaning |
|---|---|---|
| `--interval` / `INTERVAL_S` | 30 | seconds between measurements |
| `--ratio` / `TURBIDITY_DIVIDER_RATIO` | 1.5 | 1.5 for 10k+20k, 2.0 for 10k+10k (check the breadboard) |
| `--k` / `TDS_K` | 1.0 | TDS calibration factor |
| `--temp` / `WATER_TEMP_C` | 25 | water temperature for TDS compensation (no temp sensor yet) |
| `--ph-v7` / `PH_V7`, `--ph-v4` / `PH_V4` | empty | pH calibration voltages from `ph_test.py --calibrate`; empty → pH `null` |
| `--point-id` / `POINT_ID` | wp07 | which water point this station is on the map |
| `--websockets` / `IOTHUB_WEBSOCKETS=1` | off | use port 443 if the Wi-Fi blocks MQTT port 8883 |
| `--no-turbidity` / `TURBIDITY_ENABLED=0` | on | send turbidity as `null` while the sensor isn't wired right |
| `--turbidity-clear-v` / `TURBIDITY_CLEAR_V` | empty | sensor voltage in clear water, written by `--calibrate-turbidity`; empty = uncalibrated DFRobot formula |
| `--led-pins` / `LED_PINS` | 17,27,22 | GPIO numbers of the white, yellow, red LED |
| `--no-leds` | off | don't use the LEDs |
| `--batch` / `UPLOAD_BATCH` | 100 | measurements per upload message |
| `--max-rows` / `MAX_BUFFER_ROWS` | 200000 | buffer limit (≈ 70 days offline at 30 s); beyond it the oldest measurements are dropped |
| `--fake` | off | fake values, for testing without sensors |

## Offline behaviour

Measuring and uploading run in two threads, so the measurements stay on schedule whatever the network does.

1. Every measurement goes into `buffer.db` (SQLite) first.
2. The upload thread sends the oldest waiting measurements in batches of 100 whenever the IoT Hub is reachable.
3. `send_message` returns only after the IoT Hub has acknowledged the batch. Only then are exactly these rows deleted from `buffer.db`.

If the hub is unreachable the log says `offline, measurements stay in buffer.db` and the `N waiting` count grows. When the network is back (e.g. phone hotspot = "Wendy arrives"), the backlog is sent within one measurement interval and the count drops to 0. A power cut doesn't lose buffered data.

If the connection breaks between the hub's acknowledgement and the delete, that batch is sent again. This is harmless: the cloud stores history by timestamp, so a duplicate overwrites itself.

The cloud answers via the device twin (`desired.json`): recommended use (`livestock_only`, …), salt and germ level, nearest alternative water point and advice. The LEDs show it.

## Status LEDs

| LED | On when | Comes from |
|---|---|---|
| white | the station software runs (off = not running, e.g. crashed or stopped) | `uploader.py` |
| yellow | water is suspicious: probably not drinkable as it is, e.g. boil or chlorinate first | Pi: TDS > 700 ppm, pH outside 6.5–8.5, turbidity > 500 NTU · cloud: salt elevated or rising, any germ risk |
| red | water is not drinkable, whatever you do (too salty: boiling makes it worse) | Pi: TDS > 800 ppm · cloud: salt red |

Only one of yellow/red is lit, the worse one wins. Only white means "no anomaly measured", not "safe". The Pi's own rules work offline; the germ risk (rain, lab tests, source type) only comes from the cloud. The salt limits are the same placeholders as in `cloud/logic.py`.

**Warnings stay on until a person resets them.** Yellow and red switch on automatically and can only go up (yellow → red). Better water does not switch them off. The warning is kept in `alarm.json`, so it also survives a restart.

To switch it off, someone who checked the water point uses **Station lights → Reset water** in Wendy's dashboard (`/api/map`): pick the station, enter a name, tick "I checked this water point myself". The Function `/api/reset` writes `reset_water` (id, name, time) into the device twin and notifies the team (e-mail/Telegram). The twin keeps it, so a station that is offline gets the reset when it reconnects. The Pi's log shows `LED warning cleared by <name> in the dashboard`.

After a reset, the warning comes back when a measurement on the Pi is bad again, or when the cloud's verdict gets worse (none → yellow → red). The same cloud verdict sent again does not bring it back.

Wiring (BCM numbers, GPIO → resistor → long LED leg, short leg → GND):

| LED | GPIO | Pin | Resistor |
|---|---|---|---|
| white | 17 | 11 | 100 Ω (white needs ~3 V, with 330 Ω it stays almost dark) |
| yellow | 27 | 13 | 220 Ω (330 Ω works too, a bit darker) |
| red | 22 | 15 | 220 Ω |
| GND | | 9 or 14 | |

Test the wiring (each LED for one second), with the service stopped: `.venv/bin/python leds.py`

The cloud only sends the germ level (`salt` / `germs` in the twin) after the Function App has been redeployed; until then yellow comes from the Pi's own rules and from `use = people_caution`.

## Sensor range

The TDS probe outputs at most ~2.3 V, which is about 1100 ppm. The cloud's "too salty for people" limit is 800 ppm, so for the salt demo dissolve plenty of salt.

The cloud does not store pH yet (`logic.py` ignores the field); it arrives in the IoT Hub but isn't shown on the map.
