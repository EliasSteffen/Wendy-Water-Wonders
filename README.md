# Wendy's Early Signal – Azure-Teil

Starterpaket für den Hackathon. Alles läuft mit der Azure-Toolbox (IoT Hub, Functions, Maps) plus Open-Meteo fürs Wetter.

```
Arduino ──USB──► Pi (pi_sender.py, Puffer) ──┐
                                             ├──► Azure IoT Hub ──► Function "ingest" ──► Table Storage
simulate_points.py (13 Fake-Stellen) ────────┘                          │
                                                                        ├──► SMS (Twilio) + Telegram
Open-Meteo ──► Function "weather" (alle 30 Min) ──► Table Storage        ├──► Device Twin ──► zurück zum Pi
                                                                        │
Browser ──► /api/map (Azure Maps) ──► /api/state (JSON) ◄────────────────┘
            Formular ──► /api/testresult   Demo-Knöpfe ──► /api/simulate
```

## Dateien

| Datei | Was |
|---|---|
| `functions/function_app.py` | Alle Azure Functions (IoT-Trigger, Timer, HTTP) |
| `functions/logic.py` | Risikologik: Salz, Keime, Ausweichstelle, Testpriorität. Reines Python, lokal testbar |
| `functions/points.json` | Die 14 Wasserstellen. **Koordinaten sind Platzhalter bei Lodwar** |
| `functions/static/map.html` | Karte für Wendy, mit Testergebnis-Formular und Demo-Knöpfen |
| `device/pi_sender.py` | Läuft auf dem Pi: Arduino lesen, puffern, hochladen, Twin empfangen |
| `device/simulate_points.py` | Simuliert die 13 Stellen ohne Hardware, mit Befehlen für die Demo |

## 1. Datenvertrag (zuerst mit dem Hardware-Team abstimmen!)

Der Arduino schickt **eine JSON-Zeile pro Messung** über USB (9600 Baud):

```json
{"turb_ntu": 2.1, "ec_us": 655, "temp_c": 30.4, "visits": 1}
```

- `ec_us`: Leitfähigkeit in µS/cm (Salz). Pflichtfeld.
- `turb_ntu`: Trübung. Muss nicht echt in NTU sein, aber **gleiche Einheit wie `baseline_turb`** in `points.json`.
- `temp_c`: optional
- `visits`: Bewegungen seit der letzten Zeile (PIR)

Der Pi ergänzt `point_id` und `ts` und schickt gepuffert: `{"readings": [ {...}, {...} ]}`.

**Kalibrierung:** Zu Beginn klares Leitungswasser messen und die Werte bei `wp07` als `baseline_ec` und `baseline_turb` in `points.json` eintragen.

## 2. Azure aufsetzen (ca. 30 Min)

Erst klären, ob die Orga eine Subscription oder fertige Ressourcen stellt. Am einfachsten in der **Azure Cloud Shell (PowerShell)** im Browser, dann muss lokal nichts installiert sein. Namen müssen weltweit eindeutig sein, also das Suffix ändern.

```powershell
$S="wendy42"; $RG="rg-$S"; $LOC="westeurope"
$HUB="hub-$S"; $ST="st$S"; $FUNC="func-$S"; $MAPS="maps-$S"

az extension add --name azure-iot
az group create -n $RG -l $LOC

# IoT Hub (Free-Tier: 8.000 Nachrichten/Tag) + Geräte
az iot hub create -n $HUB -g $RG --sku F1 --partition-count 2
az iot hub device-identity create -n $HUB -d wp07
az iot hub device-identity create -n $HUB -d sim
az iot hub consumer-group create --hub-name $HUB --name functions

# Storage + Function App (Python 3.11, Consumption)
az storage account create -n $ST -g $RG -l $LOC --sku Standard_LRS
az functionapp create -n $FUNC -g $RG --storage-account $ST --consumption-plan-location $LOC --runtime python --runtime-version 3.11 --functions-version 4 --os-type linux

# Azure Maps
az maps account create -n $MAPS -g $RG --sku G2 --kind Gen2 --accept-tos
```

Werte einsammeln und als App Settings setzen:

```powershell
$EH_CONN = az iot hub connection-string show -n $HUB --default-eventhub -o tsv
$EH_NAME = az iot hub show -n $HUB --query properties.eventHubEndpoints.events.path -o tsv
$SVC     = az iot hub connection-string show -n $HUB --policy-name iothubowner -o tsv
$MAPSKEY = az maps account keys list -n $MAPS -g $RG --query primaryKey -o tsv

az functionapp config appsettings set -n $FUNC -g $RG --settings "IOTHUB_EH_CONN=$EH_CONN" "IOTHUB_EH_NAME=$EH_NAME" "IOTHUB_SERVICE_CONN=$SVC" "MAPS_KEY=$MAPSKEY" "REAL_DEVICE_IDS=wp07"

# Connection Strings für Pi und Simulator (aufschreiben)
az iot hub device-identity connection-string show -n $HUB -d wp07 -o tsv
az iot hub device-identity connection-string show -n $HUB -d sim -o tsv
```

## 3. Function deployen

Lokal brauchst du Python 3.11 und die Azure Functions Core Tools v4 (`winget install Microsoft.Azure.FunctionsCoreTools` oder `npm i -g azure-functions-core-tools@4`). Alternativ geht es auch über die VS-Code-Erweiterung „Azure Functions“.

```powershell
cd functions
func azure functionapp publish func-wendy42
```

Danach im Browser öffnen: `https://func-wendy42.azurewebsites.net/api/map`

**Lokal testen** (optional): `local.settings.example.json` nach `local.settings.json` kopieren und die Werte eintragen. `AzureWebJobsStorage` = Connection String des Storage-Accounts (`az storage account show-connection-string -n $ST -g $RG -o tsv`). Dann:

```powershell
py -3.11 -m venv .venv; .venv\Scripts\activate; pip install -r requirements.txt
func start
```

Die Karte liegt dann unter `http://localhost:7071/api/map`.

**Logik ohne Azure testen:** `cd functions` und `python -c "import logic; print(logic.demo())"`

## 4. Pi und Simulator starten

```bash
pip install azure-iot-device pyserial
export IOTHUB_DEVICE_CONN="HostName=...;DeviceId=wp07;SharedAccessKey=..."
python device/pi_sender.py --serial /dev/ttyACM0      # ohne Arduino: --fake
```

```powershell
pip install azure-iot-device
$env:IOTHUB_SIM_CONN="HostName=...;DeviceId=sim;SharedAccessKey=..."
python device/simulate_points.py
```

Im Simulator-Fenster tippen: `salt wp03`, `dirt wp11`, `clear all`.

**Prüfen, ob Daten ankommen:** `az iot hub monitor-events -n $HUB`

## 5. SMS und Telegram (Redundanz)

**Telegram (5 Min):** In Telegram `@BotFather` anschreiben, `/newbot` ausführen und den Token kopieren. Dem Bot eine Nachricht schicken, dann `https://api.telegram.org/bot<TOKEN>/getUpdates` öffnen und `chat.id` ablesen.

**SMS über ein Twilio-Testkonto (15 Min):** Kostenlos registrieren, eine Nummer holen und **die Empfängernummer verifizieren** (Testkonten senden nur an verifizierte Nummern, mit dem Vorsatz „Sent from your Twilio trial account“).

```powershell
az functionapp config appsettings set -n $FUNC -g $RG --settings "TELEGRAM_TOKEN=..." "TELEGRAM_CHAT_ID=..." "TWILIO_SID=..." "TWILIO_TOKEN=..." "TWILIO_FROM=+1..." "ALERT_SMS_TO=+49..."
```

Benachrichtigt wird **nur, wenn eine Stelle schlechter wird**, damit es keine SMS-Flut gibt.

## 6. Demo-Ablauf

1. Karte offen, Simulator läuft, Pi läuft **ohne WLAN**. Die Lampen am Pi reagieren lokal.
2. Salz ins Wasser an wp07, dann Pi-WLAN an (Handy-Hotspot = „Wendy kommt an“). Der Puffer lädt hoch, wp07 wird rot, und die Linie zur Ausweichstelle erscheint.
3. SMS und Telegram kommen an: „too salty for people … Nearest alternative …“
4. Knopf **Heavy rain**: Brunnen ohne Schutz werden gelb oder rot, und „Test today“ sortiert sich neu.
5. Formular: „wp06 H2S positive“ → wp06 rot. Danach „negative“ senden.
6. Knopf **Real weather**: zurück zum echten Wetter von Open-Meteo.

## 7. Was Platzhalter ist (im Pitch offen sagen)

- **Grenzwerte und Gewichte** in `logic.py` (Salz 800/1000/5000 mg/L, Gewichte der Keim-Formel). Mit WHH abstimmen.
- **Koordinaten** in `points.json`: grob bei Lodwar. Wenn möglich durch echte ersetzen.
- **Umrechnung** Leitfähigkeit → Salz: Faktor 0,6 (üblich sind 0,5–0,7).
- **13 von 14 Stellen** sind simuliert.

## 8. Fehlersuche

| Problem | Lösung |
|---|---|
| Function bekommt keine Nachrichten | `IOTHUB_EH_NAME` prüfen; der Consumer Group `functions` muss existieren. Logs: Portal → Function App → Log stream |
| Karte grau | `MAPS_KEY` fehlt, oder die Seite wurde nicht über `/api/map` geöffnet |
| `/api/state` zeigt „no data“ | Simulator bzw. Pi läuft nicht. Mit `az iot hub monitor-events` prüfen |
| Twin kommt nicht am Pi an | `IOTHUB_SERVICE_CONN` muss die `iothubowner`-Policy sein |
| Pi lädt nicht hoch | Der Pi braucht Internet, Port 8883 (MQTT) darf nicht gesperrt sein. Im Uni-/Event-WLAN kann der Port zu sein → Handy-Hotspot nehmen |

## Zeitplan für dich

| Wann | Ziel |
|---|---|
| 1. Stunde | Ressourcen anlegen, Function deployen, Karte zeigt 14 graue Punkte |
| 2. Stunde | Simulator läuft, Punkte färben sich, Simulator-Befehle getestet |
| 3. Stunde | Pi-Sender mit `--fake`, dann mit echtem Arduino; Twin kommt an |
| danach | Telegram, Twilio, Demo-Ablauf zweimal durchspielen |
