# Wendy's Early Signal – Azure-Teil

Starterpaket für den Hackathon. Alles läuft mit der Azure-Toolbox (IoT Hub, Functions, Maps) plus Open-Meteo fürs Wetter.

```
Pi 5 + MCP3008 (../pi/uploader.py, Puffer) ──┐
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
| `functions/forecast.py` | Ausblick für die nächsten Tage (Salz, Keime). Hier kommen neue Vorhersagen dazu |
| `functions/points.json` | Die 14 Wasserstellen. **Koordinaten sind Platzhalter bei Lodwar** |
| `functions/static/map.html` | Dashboard für Wendy: Karte, Kennzahlen, Salzkurve, Reset und Farbe pro Stelle, verstecktes Demo-Fenster |
| `../pi/uploader.py` | Läuft auf dem Pi: Sensoren lesen, puffern, hochladen, Twin empfangen (alt: `device/pi_sender.py` für Arduino) |
| `device/simulate_points.py` | Simuliert die 13 Stellen ohne Hardware, mit Befehlen für die Demo |

## 1. Datenvertrag (Pi → Cloud)

Die Station ist ein **Raspberry Pi 5 mit MCP3008** (TDS auf CH0, Trübung auf CH1), kein Arduino. Code und Anleitung: **`../pi/`** (`sensors.py`, `uploader.py`, `pi/README.md`).

Der Pi schickt gepuffert `{"readings": [ {...}, ... ]}`, jede Messung so:

```json
{"deviceId": "wp07", "point_id": "wp07", "ts": "2026-10-16T19:30:00Z",
 "tds_ppm": 281.0, "ec_us_cm": 562.0, "tds_v": 0.76,
 "turbidity_ntu": null, "turbidity_v": 0.02, "water_temp_c": 25.0}
```

- Die Function versteht beide Feldnamen (`ec_us_cm` oder `ec_us`, `turbidity_ntu` oder `turb_ntu`, `water_temp_c` oder `temp_c`). Der Simulator nutzt die kurzen.
- `null` (z. B. Trübung noch nicht verkabelt) und eine trockene TDS-Sonde (< 5 µS/cm) werden ignoriert, der letzte gültige Wert bleibt.
- Fehlt `point_id`, nimmt die Function die IoT-Hub-Geräte-ID (`wp07`).
- Salz in mg/L = Leitfähigkeit × 0,5 (wie auf dem Pi).

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

**Echter Pi:** siehe `../pi/README.md` (`uploader.py --dry-run` testen, dann ohne `--dry-run`). `device/pi_sender.py` ist die alte Arduino-Variante und wird nicht mehr gebraucht.

```powershell
pip install azure-iot-device
$env:IOTHUB_SIM_CONN="HostName=...;DeviceId=sim;SharedAccessKey=..."
python device/simulate_points.py
```

Im Simulator-Fenster tippen: `salt wp03`, `dirt wp11`, `clear all`.

**Prüfen, ob Daten ankommen:** `az iot hub monitor-events -n $HUB`

## 5. Benachrichtigungen: SMS (Twilio) + E-Mail (Azure Communication Services)

Jede Warnung geht über alle eingerichteten Kanäle raus (Redundanz). Nicht eingerichtete Kanäle werden übersprungen. Telegram geht optional zusätzlich.

**Test jederzeit:** `https://<func-name>.azurewebsites.net/api/testalert` öffnen. Die Antwort zeigt pro Kanal `sent`, `not configured` oder die Fehlermeldung.

### SMS über Twilio
1. Auf twilio.com/try-twilio registrieren, E-Mail und Handynummer bestätigen.
2. Console: **Account SID** und **Auth Token** kopieren, **„Get a phone number“** (Testnummer).
3. Weitere Empfänger unter *Phone Numbers → Manage → Verified Caller IDs* bestätigen (Testkonten senden nur an bestätigte Nummern).
4. *Messaging → Settings → Geo permissions*: **Deutschland** aktivieren.
5. ```powershell
   az functionapp config appsettings set -n $FUNC -g $RG --settings "TWILIO_SID=AC..." "TWILIO_TOKEN=..." "TWILIO_FROM=+1..." "ALERT_SMS_TO=+49151...,+49160..." -o none
   ```

### SMS über Azure (statt Twilio, an beliebige Nummern)
Nach Deutschland erlaubt Azure nur einen **dynamischen alphanumerischen Absender** (z. B. „WendyWater“), keine Telefonnummer. Keine Bestätigung der Empfänger nötig.
1. Die Communication-Services-Ressource aus dem E-Mail-Abschnitt nutzen (`acs-$S`).
2. Portal: `acs-$S` → **Alphanumeric Sender ID** → Reiter **Dynamic** → **Enable Alphanumeric Sender ID**.
   Ist der Knopf grau, muss Microsoft das für den Tenant freischalten: kostenlose Anfrage unter *Help + support → Create a support request → Service and subscription limits (quotas) → Other Requests*. Das kann dauern, dann Twilio als Plan B.
3. ```powershell
   az functionapp config appsettings set -n $FUNC -g $RG --settings "ACS_SMS_FROM=WendyWater" "ALERT_SMS_TO=+49151..." -o none
   ```
Ist `ACS_SMS_FROM` gesetzt, geht die SMS über Azure, sonst über Twilio. Löschen von `ACS_SMS_FROM` schaltet zurück auf Twilio.

### E-Mail über Azure Communication Services
```powershell
az extension add --name communication --only-show-errors
az provider show -n Microsoft.Communication --query registrationState -o tsv   # muss "Registered" sein
az communication create -n "acs-$S" -g $RG --location global --data-location Europe -o none
az communication email create -n "mail-$S" -g $RG --location global --data-location Europe -o none
az communication email domain create --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --location global --domain-management AzureManaged -o none
$DOMAIN_ID = az communication email domain show --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --query id -o tsv
$SENDER_DOMAIN = az communication email domain show --domain-name AzureManagedDomain --email-service-name "mail-$S" -g $RG --query mailFromSenderDomain -o tsv
az communication update -n "acs-$S" -g $RG --linked-domains $DOMAIN_ID -o none
$ACS_CONN = az communication list-key -n "acs-$S" -g $RG --query primaryConnectionString -o tsv
az functionapp config appsettings set -n $FUNC -g $RG --settings "ACS_CONNECTION_STRING=$ACS_CONN" "ACS_EMAIL_SENDER=DoNotReply@$SENDER_DOMAIN" "ALERT_EMAIL_TO=du@example.com" -o none
```

**Über das Portal (falls die CLI streikt):** „Email Communication Services“ anlegen → *Provision domains → Add domain → Azure subdomain*. Dann „Communication Services“ anlegen → *Email → Domains → Connect domain*. Connection String unter *Keys*, Absenderadresse unter der Domain (*MailFrom addresses*).

**Grenzen:** Die von Azure verwaltete Domain erlaubt nur wenige Mails pro Stunde und landet anfangs gern im Spam-Ordner. Für die Demo reicht das.

### Telegram (optional)
`@BotFather` → `/newbot` → Token. Dem Bot schreiben, `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id`.
```powershell
az functionapp config appsettings set -n $FUNC -g $RG --settings "TELEGRAM_TOKEN=..." "TELEGRAM_CHAT_ID=..." -o none
```

Benachrichtigt wird **nur, wenn eine Stelle schlechter wird**, damit es keine Flut gibt. **Automatische SMS gibt es nur bei sehr hohem Salz:** Salz ≥ `SMS_SALT_MIN_TDS` (Standard 1000 mg/L) in `SMS_SALT_CONFIRM` Messungen hintereinander (Standard 2), und nur für die Stellen in `SMS_POINTS` (Standard: die echte Station `wp07`, `all` = alle). Pro Ereignis eine SMS; erst wenn das Salz wieder fällt, kann die nächste kommen. Keime, Regen, Ausblick und Sammelmeldungen gehen nur per E-Mail/Telegram. Zum Schutz des Testguthabens gilt ein Tageslimit: `SMS_MAX_PER_DAY` (Standard 20) als App Setting ändern. Im echten Betrieb in Kenia wäre Africa's Talking statt Twilio sinnvoll; dafür muss nur `_send_sms` getauscht werden.

## 6. Demo-Ablauf

Das Dashboard zeigt nur das Wichtigste: Kennzahlen oben, Karte, „Needs attention“, die ausgewählte Stelle mit Salzkurve und die nächsten 10 Tage. Die Demo-Knöpfe sind versteckt: Knopf **Demo** unten rechts auf der Karte oder Taste **D**.

Bei jeder Stelle (auf der Karte anklicken) gibt es unten **Set light** (blau, gelb, rot von Hand setzen) und **Reset**. Von Hand gesetzte Farben lösen keine SMS aus. **Reset** setzt die Stelle zurück: Testergebnisse und Handfarbe weg, der aktuelle Messwert gilt als neuer Normalwert, und die nächste Auswertung schickt keine Alarme. Bei der LIVE-Station (wp07) vorher Name eintragen und „I checked the water“ anhaken: Reset schaltet dann auch die Lampen an der Station aus (über den Device Twin). Eine von Hand gesetzte Farbe geht ebenfalls an die Lampen der Station. **Reset all** im Demo-Fenster macht das für alle Stellen und schaltet das Demo-Wetter aus. Läuft der Simulator mit einem Salz-Ereignis, dort zusätzlich `clear all` tippen.

1. Vorher: **Reset all** und im Simulator `clear all`. Normal ist dann fast alles blau (wp10 gelb, leicht erhöhtes Salz).
2. Salz ins Wasser an wp07 (LIVE). wp07 wird rot, die Linie zur Ausweichstelle erscheint, die SMS kommt.
3. Demo → **Heavy rain**: Brunnen ohne Schutz werden gelb oder rot, „Test today“ sortiert sich neu.
4. Demo → **Germ test +** für die ausgewählte Stelle → rot. Danach **Germ test −** oder **Reset**.
5. Demo → **Dry & hot**, dann im Simulator `salt wp03`: wp03 bekommt den orangen Ring („getting worse soon“).
6. Demo → **Reset all**.

## Ausblick (Outlook) und neue Vorhersagen

Die Function `weather` holt alle 30 Minuten:
- die **vergangenen 60 Tage** von Open-Meteo (Länge der Trockenphase, erster Starkregen),
- die **nächsten 10 Tage** von **Azure Maps Weather** (Regen und Höchsttemperatur). Klappt das nicht, springt Open-Meteo ein. Welche Quelle genutzt wurde, steht unter der Wetterleiste auf der Karte („Forecast: azure-maps“).

`forecast.py` macht daraus pro Stelle einen Ausblick:

| Vorhersage | Regel (Platzhalter) |
|---|---|
| `salt_outlook` | Salz steigt + weniger als 20 mm Regen in 10 Tagen → „wird sich verschärfen, Ausweichstelle oder Wassertransport jetzt planen“ |
| `germ_outlook` | Starkregen (≥ 10 mm) in den nächsten 3 Tagen nach ≥ 14 trockenen Tagen, an ungeschützten Stellen → „Chlor bereitlegen, nach dem Regen testen“ |

**Neue Vorhersage hinzufügen:** In `forecast.py` eine Funktion mit `@predictor` schreiben, die `None` oder ein Dictionary mit `kind`, `level`, `horizon_days`, `title`, `message` und `drivers` zurückgibt. API, Karte (Ring + Liste) und SMS übernehmen sie automatisch. Ideen: Wasserbedarf bei Hitze, Überlastung der Ausweichstellen, Ausfall einer Pumpe.

Die Optik: Auf der Karte zeigt ein **Ring** um eine Stelle „wird bald schlechter“. In der Seitenleiste stehen die 10 Tage als kleine Wetterleiste und darunter die Ausblicke. Der Knopf **Show clouds** blendet das Infrarot-Wolkenbild von Azure Maps ein.

## 7. Was Platzhalter ist (im Pitch offen sagen)

- **Grenzwerte und Gewichte** in `logic.py` (Salz 800/1000/5000 mg/L, Gewichte der Keim-Formel). Mit WHH abstimmen.
- **Koordinaten** in `points.json`: grob bei Lodwar. Wenn möglich durch echte ersetzen.
- **Umrechnung** Leitfähigkeit → Salz: Faktor 0,5 wie auf dem Pi (üblich sind 0,5–0,7).
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
