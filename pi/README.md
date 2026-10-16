# Pi: water sensors → Azure IoT Hub

Raspberry Pi 5 + MCP3008 (TDS on CH0, turbidity on CH1). See `CLAUDE.md` for wiring.

| File | What |
|---|---|
| `sensors.py` | Shared sensor code: median ADC reads, TDS and turbidity conversion. Import it from `tds_test.py` / `turbidity_test.py` instead of copying the formulas |
| `uploader.py` | Measures every 30 s, buffers in SQLite, uploads to Azure IoT Hub, receives the device twin |
| `.env.example` | Template for `~/water-quality/.env` (connection string etc.) |
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

## Test

```bash
.venv/bin/python uploader.py --dry-run --count 3          # real sensors, prints JSON, sends nothing
.venv/bin/python uploader.py --count 3 --interval 10      # real upload, 3 messages
```

Expected: `sent 1 · TDS 281.0 ppm · NTU None`. On Wendy's map (`/api/map`) water point **wp07** gets real values within a minute.

Turbidity sends `null` while CH1 has no signal; the cloud keeps working with TDS only.

## Run permanently

```bash
sudo cp water-uploader.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now water-uploader
journalctl -u water-uploader -f                           # live log
```

## Options

| Flag / .env | Default | Meaning |
|---|---|---|
| `--interval` / `INTERVAL_S` | 30 | seconds between measurements |
| `--ratio` / `TURBIDITY_DIVIDER_RATIO` | 1.5 | 1.5 for 10k+20k, 2.0 for 10k+10k (check the breadboard) |
| `--k` / `TDS_K` | 1.0 | TDS calibration factor |
| `--temp` / `WATER_TEMP_C` | 25 | water temperature for TDS compensation (no temp sensor yet) |
| `--point-id` / `POINT_ID` | wp07 | which water point this station is on the map |
| `--websockets` / `IOTHUB_WEBSOCKETS=1` | off | use port 443 if the Wi-Fi blocks MQTT port 8883 |
| `--fake` | off | fake values, for testing without sensors |

## Offline behaviour

Every measurement goes into `buffer.db` first. If the IoT Hub is unreachable the uploader logs `offline, buffered (N waiting)` and keeps measuring. When the network is back (e.g. phone hotspot = "Wendy arrives"), all waiting measurements are sent in one batch.

The cloud answers via the device twin (`desired.json`): recommended use (`livestock_only`, …), nearest alternative water point and advice. This is what local LEDs/buzzer could show later.

## Sensor range

The TDS probe outputs at most ~2.3 V, which is about 1100 ppm. The cloud's "too salty for people" limit is 1000 ppm, so for the salt demo dissolve a lot of salt.
