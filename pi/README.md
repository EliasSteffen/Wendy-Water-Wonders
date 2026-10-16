# Pi: water sensors → Azure IoT Hub

Raspberry Pi 5 + MCP3008 (TDS on CH0, turbidity on CH1, pH on CH2). See `CLAUDE.md` for wiring.

| File | What |
|---|---|
| `sensors.py` | Shared sensor code: median ADC reads, TDS, turbidity and pH conversion. Import it from `tds_test.py` / `turbidity_test.py` / `ph_test.py` instead of copying the formulas |
| `uploader.py` | Measures every 30 s (configurable), buffers in SQLite, uploads to Azure IoT Hub, deletes what the hub acknowledged, receives the device twin |
| `.env.example` | Template for `~/water-quality/.env` (connection string, pH calibration, interval) |
| `water-uploader.service` | systemd unit to start the uploader on boot |

## Setup on the Pi (once)

```bash
# from the repo root on your laptop
scp pi/sensors.py pi/uploader.py pi/.env.example pi/water-uploader.service hacki:~/water-quality/

ssh hacki
cd ~/water-quality
python3 -m venv --system-site-packages .venv      # keeps apt's gpiozero/spidev importable
.venv/bin/pip install azure-iot-device
cp .env.example .env && nano .env                  # paste the connection string for device wp07
```

The connection string comes from Azure (ask Maxi, it's a password):
`az iot hub device-identity connection-string show -n hub-wendy7973 -d wp07 -o tsv`

pH: run `python3 ph_test.py --calibrate` with pH 7.0 and pH 4.0 buffers and put the two voltages into `.env` as `PH_V7` / `PH_V4`. Until then pH is sent as `null` (with `ph_note: "not_calibrated"`); the raw voltage `ph_v` is always sent.

## Test

```bash
.venv/bin/python uploader.py --dry-run --count 3          # real sensors, prints JSON, sends nothing
.venv/bin/python uploader.py --count 3 --interval 10      # real upload, 3 measurements
```

Expected: `measured · TDS 281.0 ppm · pH 7.1 · NTU None · 1 waiting`, then `sent 1 · 0 waiting`. On Wendy's map (`/api/map`) water point **wp07** gets real values within a minute.

Turbidity sends `null` while CH1 has no signal; the cloud keeps working with TDS only.

## Run permanently

```bash
sudo cp water-uploader.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now water-uploader
journalctl -u water-uploader -f                           # live log
```

## Demo: measure faster

Needs the setup above first (`.env` with the connection string, service installed).

The default is one measurement every 30 s. To change it, edit `INTERVAL_S` in `~/water-quality/.env` and restart:

```bash
ssh hacki
sed -i 's/^INTERVAL_S=.*/INTERVAL_S=5/' ~/water-quality/.env
sudo systemctl restart water-uploader
journalctl -u water-uploader -f                           # check: "every 5s"
```

Set it back to `30` after the demo. The IoT Hub free tier allows ~8,000 messages per day: 30 s is fine all day, 5 s only for a few hours. If the quota runs out, uploads fail and the measurements simply stay in the buffer until the next day.

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

The cloud answers via the device twin (`desired.json`): recommended use (`livestock_only`, …), nearest alternative water point and advice. This is what local LEDs/buzzer could show later.

## Sensor range

The TDS probe outputs at most ~2.3 V, which is about 1100 ppm. The cloud's "too salty for people" limit is 1000 ppm, so for the salt demo dissolve a lot of salt.

The cloud does not store pH yet (`logic.py` ignores the field); it arrives in the IoT Hub but isn't shown on the map.
