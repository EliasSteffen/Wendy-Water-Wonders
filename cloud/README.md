# Wendy's Early Signal – cloud

Built during the hackathon. Everything runs on the Azure toolbox (IoT Hub, Functions, Maps) plus Open-Meteo for the weather.

```
Pi 5 + MCP3008 (../station/uploader.py, buffer) ──┐
                                                  ├──► Azure IoT Hub ──► Function "ingest" ──► Table Storage
simulate_points.py (13 simulated points) ─────────┘                          │
                                                                             ├──► SMS + e-mail + Telegram
Open-Meteo ──► Function "weather" (every 30 min) ──► Table Storage            ├──► device twin ──► back to the Pi
                                                                             │
Browser ──► /api/map (Azure Maps) ──► /api/state (JSON) ◄─────────────────────┘
            form ──► /api/testresult   demo buttons ──► /api/simulate
```

## Files

| File | What |
|---|---|
| `function_app.py` | All Azure Functions (IoT trigger, timer, HTTP) |
| `logic.py` | Risk logic: salt, germs, alternative water point, test priority. Plain Python, testable locally |
| `forecast.py` | Outlook for the next days (salt, germs). New predictions go here |
| `points.json` | The 14 water points. **Coordinates are placeholders near Lodwar** |
| `static/map.html` | Wendy's dashboard: map, situation, salt chart, reset and colour per point |
| `../station/uploader.py` | Runs on the Pi: reads the sensors, buffers, uploads, receives the device twin |
| `../simulator/simulate_points.py` | Simulates the other 13 points without hardware, with commands for the demo |

## 1. Data contract (Pi → cloud)

The station is a **Raspberry Pi 5 with an MCP3008** (TDS on CH0, turbidity on CH1, pH on CH2). Code and setup: **`../station/`** (`sensors.py`, `uploader.py`, `README.md`).

The Pi sends buffered batches `{"readings": [ {...}, ... ]}`, each measurement like this:

```json
{"deviceId": "wp07", "point_id": "wp07", "ts": "2026-10-16T19:30:00Z",
 "tds_ppm": 281.0, "ec_us_cm": 562.0, "tds_v": 0.76,
 "turbidity_ntu": null, "turbidity_v": 0.02, "water_temp_c": 25.0}
```

- The Function accepts both field names (`ec_us_cm` or `ec_us`, `turbidity_ntu` or `turb_ntu`, `water_temp_c` or `temp_c`). The simulator uses the short ones.
- `null` (e.g. turbidity not wired yet) and a dry TDS probe (< 5 µS/cm) are ignored; the last valid value stays.
- Without `point_id` the Function uses the IoT Hub device ID (`wp07`).
- Salt in mg/L = conductivity × 0.5 (same as on the Pi).

## 2. Set up Azure (about 30 min)

Easiest in the **Azure Cloud Shell (PowerShell)** in the browser, so nothing has to be installed locally. Names must be globally unique, so change the suffix.

```powershell
$S="wendy42"; $RG="rg-$S"; $LOC="westeurope"
$HUB="hub-$S"; $ST="st$S"; $FUNC="func-$S"; $MAPS="maps-$S"

az extension add --name azure-iot
az group create -n $RG -l $LOC

# IoT Hub (free tier: 8,000 messages/day) + devices
az iot hub create -n $HUB -g $RG --sku F1 --partition-count 2
az iot hub device-identity create -n $HUB -d wp07
az iot hub device-identity create -n $HUB -d sim
az iot hub consumer-group create --hub-name $HUB --name functions

# Storage + Function App (Python 3.11, consumption plan)
az storage account create -n $ST -g $RG -l $LOC --sku Standard_LRS
az functionapp create -n $FUNC -g $RG --storage-account $ST --consumption-plan-location $LOC --runtime python --runtime-version 3.11 --functions-version 4 --os-type linux

# Azure Maps
az maps account create -n $MAPS -g $RG --sku G2 --kind Gen2 --accept-tos
```

Collect the values and set them as app settings:

```powershell
$EH_CONN = az iot hub connection-string show -n $HUB --default-eventhub -o tsv
$EH_NAME = az iot hub show -n $HUB --query properties.eventHubEndpoints.events.path -o tsv
$SVC     = az iot hub connection-string show -n $HUB --policy-name iothubowner -o tsv
$MAPSKEY = az maps account keys list -n $MAPS -g $RG --query primaryKey -o tsv

az functionapp config appsettings set -n $FUNC -g $RG --settings "IOTHUB_EH_CONN=$EH_CONN" "IOTHUB_EH_NAME=$EH_NAME" "IOTHUB_SERVICE_CONN=$SVC" "MAPS_KEY=$MAPSKEY" "REAL_DEVICE_IDS=wp07"

# Connection strings for the Pi and the simulator (they are passwords: keep them out of git)
az iot hub device-identity connection-string show -n $HUB -d wp07 -o tsv
az iot hub device-identity connection-string show -n $HUB -d sim -o tsv
```

## 3. Deploy the Function

Locally you need Python 3.11 and the Azure Functions Core Tools v4 (`winget install Microsoft.Azure.FunctionsCoreTools` or `npm i -g azure-functions-core-tools@4`). The VS Code extension "Azure Functions" works too.

```powershell
cd cloud
func azure functionapp publish func-wendy42
```

Then open `https://func-wendy42.azurewebsites.net/api/map` in the browser.

**Run locally** (optional): copy `local.settings.example.json` to `local.settings.json` and fill in the values. `AzureWebJobsStorage` = connection string of the storage account (`az storage account show-connection-string -n $ST -g $RG -o tsv`). Then:

```powershell
py -3.11 -m venv .venv; .venv\Scripts\activate; pip install -r requirements.txt
func start
```

The map is then at `http://localhost:7071/api/map`.

**Test the logic without Azure:** `cd cloud` and `python -c "import logic; print(logic.demo())"`

## 4. Start the Pi and the simulator

**Real Pi:** see `../station/README.md` (test with `uploader.py --dry-run` first, then without `--dry-run`).

```powershell
pip install azure-iot-device
$env:IOTHUB_SIM_CONN="HostName=...;DeviceId=sim;SharedAccessKey=..."
python ../simulator/simulate_points.py
```

Type in the simulator window: `salt wp03`, `dirt wp11`, `clear all`.

**Check that data arrives:** `az iot hub monitor-events -n $HUB`

## 5. Alerts: SMS (Twilio or Azure) + e-mail (Azure Communication Services)

Every alert goes out on all configured channels (redundancy). Channels that aren't configured are skipped. Telegram is an optional extra.

**Test any time:** open `https://<func-name>.azurewebsites.net/api/testalert`. The answer shows `sent`, `not configured` or the error message per channel.

### SMS via Twilio
1. Sign up at twilio.com/try-twilio and confirm your e-mail and phone number.
2. Console: copy the **Account SID** and **Auth Token**, then **"Get a phone number"** (trial number).
3. Verify further recipients under *Phone Numbers → Manage → Verified Caller IDs* (trial accounts only send to verified numbers).
4. *Messaging → Settings → Geo permissions*: enable the recipients' country.
5. ```powershell
   az functionapp config appsettings set -n $FUNC -g $RG --settings "TWILIO_SID=AC..." "TWILIO_TOKEN=..." "TWILIO_FROM=+1..." "ALERT_SMS_TO=+49151...,+49160..." -o none
   ```

### SMS via Azure (instead of Twilio, to any number)
For Germany Azure only allows a **dynamic alphanumeric sender** (e.g. "WendyWater"), not a phone number. Recipients don't need to be verified.
1. Use the Communication Services resource from the e-mail section (`acs-$S`).
2. Portal: `acs-$S` → **Alphanumeric Sender ID** → tab **Dynamic** → **Enable Alphanumeric Sender ID**.
   If the button is greyed out, Microsoft has to enable it for the tenant: free request under *Help + support → Create a support request → Service and subscription limits (quotas) → Other Requests*. This can take a while; use Twilio as plan B.
3. ```powershell
   az functionapp config appsettings set -n $FUNC -g $RG --settings "ACS_SMS_FROM=WendyWater" "ALERT_SMS_TO=+49151..." -o none
   ```
If `ACS_SMS_FROM` is set, SMS go through Azure, otherwise through Twilio. Deleting `ACS_SMS_FROM` switches back to Twilio.

### E-mail via Azure Communication Services
```powershell
az extension add --name communication --only-show-errors
az provider show -n Microsoft.Communication --query registrationState -o tsv   # must be "Registered"
az communication create -n "acs-$S" -g $RG --location global --data-location Europe -o none
az communication email create -n "mail-$S" -g $RG --location global --data-location Europe -o none
az communication email domain create --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --location global --domain-management AzureManaged -o none
$DOMAIN_ID = az communication email domain show --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --query id -o tsv
$SENDER_DOMAIN = az communication email domain show --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --query mailFromSenderDomain -o tsv
az communication update -n "acs-$S" -g $RG --linked-domains $DOMAIN_ID -o none
$ACS_CONN = az communication list-key -n "acs-$S" -g $RG --query primaryConnectionString -o tsv
az functionapp config appsettings set -n $FUNC -g $RG --settings "ACS_CONNECTION_STRING=$ACS_CONN" "ACS_EMAIL_SENDER=DoNotReply@$SENDER_DOMAIN" "ALERT_EMAIL_TO=you@example.com" -o none
```

**In the portal (if the CLI fails):** create "Email Communication Services" → *Provision domains → Add domain → Azure subdomain*. Then create "Communication Services" → *Email → Domains → Connect domain*. The connection string is under *Keys*, the sender address under the domain (*MailFrom addresses*).

**Limits:** the Azure-managed domain only allows a few e-mails per hour and often lands in spam at first. Good enough for a demo.

### Telegram (optional)
`@BotFather` → `/newbot` → token. Send the bot a message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id`.
```powershell
az functionapp config appsettings set -n $FUNC -g $RG --settings "TELEGRAM_TOKEN=..." "TELEGRAM_CHAT_ID=..." -o none
```

Alerts are sent **only when a point gets worse**, so there is no flood. **Automatic SMS only for very high salt:** salt ≥ `SMS_SALT_MIN_TDS` (default 800 mg/L) in `SMS_SALT_CONFIRM` measurements in a row (default 2), and only for the points in `SMS_POINTS` (default: the real station `wp07`, `all` = all points). One SMS per event; the next one can only come after the salt has dropped again. Germs, rain, outlook and summaries only go out by e-mail/Telegram. To protect the trial credit there is a daily limit: change `SMS_MAX_PER_DAY` (default 20) as an app setting. For real use in Kenya, Africa's Talking would make more sense than Twilio; only `_send_sms` needs to be swapped.

## 6. Demo

**Names:** on the dashboard and in SMS, e-mail and Telegram the points are called `well01` … `well14`. Internally the IDs stay `wp01` … `wp14` (IoT Hub device `wp07`, `POINT_ID=wp07` on the Pi, `REAL_DEVICE_IDS=wp07`); nothing needs to change there. The simulator understands both (`salt well03` or `salt wp03`). The SMS no longer gives an exact salt value. A white dashed line only appears from a red point to the suggested alternative.

Points on the map are white ("no anomaly measured", never "safe") or yellow (watch). Only the LIVE station (wp07) can turn red; simulated points go up to yellow at most. A yellow point with a red outline means "getting worse fast": salt rises quickly or the forecast is bad, but the limit isn't reached yet. Only a white or yellow point is suggested as an alternative, white preferred; it is shown as text in the side panel. Clicking salt, turbidity, pH or rain switches the chart below. Rain shows daily values for the region (Lodwar): the last 14 days (Open-Meteo) and the next 10 days (Azure Maps Weather); past days appear after the next weather update, which runs every 30 minutes and when the Function starts. The right-hand panel has a fixed size: alerts, watch and affected people at the top, then the status of the LIVE station, below it the selected point (click the map) with the salt (TDS), turbidity and pH sensors, the salt chart and the advice. The germ risk is only shown small, as an estimate, because it isn't measured. A pH outside 6.5–8.5 makes a point yellow, like the lights on the station.

Every point has **Set yellow**, **Set red** and **Reset**. A colour set by hand sends no SMS. For the LIVE station it also goes to the lights, but only upwards. **Reset** resets the point: test results and the manual colour are cleared, the current reading becomes the new baseline, and no alerts go out. For wp07, Reset needs your name and the tick "I checked the water myself"; then the lights on the station go off too. They come back on if the station keeps measuring salty or turbid water. **Reset all points** at the bottom right resets all points and switches off any demo weather. If the simulator is running a salt event, also type `clear all` there.

1. Before: **Reset all points**, `clear all` in the simulator, probe in normal water.
2. Salt into the water at wp07 (LIVE). wp07 turns red, the light on the station turns red, the line to the alternative appears, the SMS arrives.
3. Probe back into normal water; at wp07 enter a name, tick the box, **Reset**.
4. Optionally click another point and show **Set yellow** or **Set red**.

## Outlook and new predictions

The Function `weather` fetches every 30 minutes:
- the **past 60 days** from Open-Meteo (length of the dry spell, first heavy rain),
- the **next 10 days** from **Azure Maps Weather** (rain and maximum temperature). If that fails, Open-Meteo steps in. The source used is shown below the weather strip on the map ("Forecast: azure-maps").

`forecast.py` turns this into an outlook per point:

| Prediction | Rule (placeholder) |
|---|---|
| `salt_outlook` | salt rising + less than 20 mm rain in 10 days → "will get worse, plan an alternative or water trucking now" |
| `germ_outlook` | heavy rain (≥ 10 mm) in the next 3 days after ≥ 14 dry days, at unprotected points → "have chlorine ready, test after the rain" |

**Add a prediction:** write a function with `@predictor` in `forecast.py` that returns `None` or a dictionary with `kind`, `level`, `horizon_days`, `title`, `message` and `drivers`. The API, the map (ring + list) and the SMS pick it up automatically. Ideas: water demand in a heatwave, overloaded alternative points, a failing pump.

On the map a **ring** around a point means "will get worse soon". The side panel shows the 10 days as a small weather strip with the outlooks below. The **Show clouds** button overlays the infrared cloud image from Azure Maps.

## 7. What is a placeholder

- **Limits and weights** in `logic.py` (salt 700/800/5000 mg/L, weights of the germ formula). To be agreed with Welthungerhilfe.
- **Coordinates** in `points.json`: roughly near Lodwar. Replace with real ones where possible.
- **Conversion** conductivity → salt: factor 0.5 as on the Pi (0.5–0.7 is common).
- **13 of 14 points** are simulated.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| Function gets no messages | Check `IOTHUB_EH_NAME`; the consumer group `functions` must exist. Logs: portal → Function App → Log stream |
| Map is grey | `MAPS_KEY` is missing, or the page wasn't opened via `/api/map` |
| `/api/state` says "no data" | Simulator or Pi isn't running. Check with `az iot hub monitor-events` |
| Twin doesn't reach the Pi | `IOTHUB_SERVICE_CONN` must use the `iothubowner` policy |
| Pi doesn't upload | The Pi needs internet and port 8883 (MQTT) must not be blocked. University or event Wi-Fi often blocks it: use a phone hotspot or `IOTHUB_WEBSOCKETS=1` (port 443) |
