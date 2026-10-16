"""Azure Functions (Python v2 model) for Wendy's Early Signal.

Endpoints / triggers
  ingest        IoT Hub trigger: stores readings, re-assesses, sends alerts
  weather       Timer (every 30 min): rain features from Open-Meteo
  GET  /api/state       all water points + alternatives + test priorities (JSON)
  GET  /api/map         the Azure Maps page
  GET  /api/history?id=wp07&n=150   salt history of one point (for the trend chart)
  POST /api/testresult  {"point_id":"wp07","test":"h2s|cbt|salt_kit","result":"positive|negative"}
  POST /api/simulate    {"preset":"heavy_rain|forecast|dry|reset"}  (demo weather override)
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import azure.functions as func
from azure.data.tables import TableServiceClient, UpdateMode

import forecast
import logic

app = func.FunctionApp()

TABLE_NAME = "wendystate"
WEATHER_LAT, WEATHER_LON = 3.12, 35.60          # Lodwar, reference for all points
REAL_DEVICES = [d.strip() for d in os.environ.get("REAL_DEVICE_IDS", "wp07").split(",") if d.strip()]


# ---------------------------------------------------------------- storage --
def _table():
    svc = TableServiceClient.from_connection_string(os.environ["AzureWebJobsStorage"])
    return svc.create_table_if_not_exists(TABLE_NAME)


def _get(tc, pk, rk):
    try:
        return json.loads(tc.get_entity(pk, rk).get("data", "{}"))
    except Exception:
        return {}


def _put(tc, pk, rk, data):
    tc.upsert_entity({"PartitionKey": pk, "RowKey": rk, "data": json.dumps(data)},
                     mode=UpdateMode.REPLACE)


def _weather(tc):
    w = _get(tc, "weather", "current")
    ov = _get(tc, "weather", "override")
    if ov.get("active"):
        w = {**w, **ov}
    return w


def _assess_all(tc):
    states = {e["RowKey"]: json.loads(e.get("data", "{}"))
              for e in tc.query_entities("PartitionKey eq 'point'")}
    weather = _weather(tc)
    assessed = [logic.assess(p, states.get(pid, {}), weather) for pid, p in logic.POINTS.items()]
    for a in assessed:
        a["outlook"], a["outlook_level"] = forecast.outlook_for(logic.POINTS[a["id"]], a, weather)
    logic.add_alternatives(assessed)
    return {"points": assessed,
            "priorities": logic.test_priorities(assessed),
            "weather": weather,
            "generated": datetime.now(timezone.utc).isoformat()}


# ---------------------------------------------------------- notifications --
def _send_sms(text):
    sid, tok = os.environ.get("TWILIO_SID"), os.environ.get("TWILIO_TOKEN")
    frm, to = os.environ.get("TWILIO_FROM"), os.environ.get("ALERT_SMS_TO")
    if not all((sid, tok, frm, to)):
        return
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    for number in to.split(","):
        data = urllib.parse.urlencode({"To": number.strip(), "From": frm, "Body": text}).encode()
        req = urllib.request.Request(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", data=data,
            headers={"Authorization": f"Basic {auth}"})
        try:
            urllib.request.urlopen(req, timeout=10)
        except Exception as e:
            logging.error("SMS failed: %s", e)


def _send_telegram(text):
    tok, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (tok and chat):
        return
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    try:
        urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data=data, timeout=10)
    except Exception as e:
        logging.error("Telegram failed: %s", e)


def _notify(text):
    logging.info("ALERT:\n%s", text)
    _send_sms(text)        # channel 1
    _send_telegram(text)   # channel 2 (redundancy)


# ------------------------------------------------------------ device twin --
def _update_twin(device_id, desired):
    """Write desired properties via the IoT Hub REST API (no extra SDK needed)."""
    cs = os.environ.get("IOTHUB_SERVICE_CONN")
    if not cs:
        return
    parts = dict(p.split("=", 1) for p in cs.split(";") if p)
    host, key_name, key = parts["HostName"], parts["SharedAccessKeyName"], parts["SharedAccessKey"]
    expiry = int(time.time()) + 3600
    uri = urllib.parse.quote_plus(host)
    sig = base64.b64encode(hmac.new(base64.b64decode(key), f"{uri}\n{expiry}".encode(),
                                    hashlib.sha256).digest())
    token = f"SharedAccessSignature sr={uri}&sig={urllib.parse.quote_plus(sig)}&se={expiry}&skn={key_name}"
    req = urllib.request.Request(
        f"https://{host}/twins/{device_id}?api-version=2021-04-12",
        data=json.dumps({"properties": {"desired": desired}}).encode(), method="PATCH",
        headers={"Authorization": token, "Content-Type": "application/json", "If-Match": "*"})
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        logging.error("Twin update failed for %s: %s", device_id, e)


def _refresh_and_notify(tc):
    """Re-assess everything; alert only when a point gets worse; push twin updates."""
    result = _assess_all(tc)
    weather = result["weather"]
    escalated_points = []
    for a in result["points"]:
        prev = _get(tc, "notify", a["id"])
        cur = {"level": a["level"], "salt": a["salt"], "germs": a["germs"],
               "outlook": a["outlook_level"], "alt": (a["alternative"] or {}).get("id")}
        first_time = not prev
        escalated = (not first_time and (
            logic.LEVELS.index(a["salt"]) > logic.LEVELS.index(prev.get("salt", "none")) or
            logic.LEVELS.index(a["germs"]) > logic.LEVELS.index(prev.get("germs", "none")) or
            (a["outlook_level"] == "red" and prev.get("outlook", "none") != "red")))
        if escalated and (a["level"] in ("yellow", "red") or a["outlook_level"] == "red"):
            escalated_points.append(a)
        if a["id"] in REAL_DEVICES and (first_time or cur != prev):
            _update_twin(a["id"], {
                "alternative": a["alternative"],
                "use": a["use"],
                "advice": a["advice"][:3],
                "rain_forecast_48h": weather.get("rain_forecast_48h", 0),
                "dry_days": weather.get("dry_days", 0),
                "updated": result["generated"],
            })
        if first_time or cur != prev:
            _put(tc, "notify", a["id"], cur)

    # One SMS per point if few changed, otherwise one summary (no SMS flood)
    if 0 < len(escalated_points) <= 2:
        for a in escalated_points:
            _notify(logic.message_for(a))
    elif len(escalated_points) > 2:
        red = [a["id"] for a in escalated_points if a["level"] == "red"]
        yellow = [a["id"] for a in escalated_points if a["level"] == "yellow"]
        outlook = [a["id"] for a in escalated_points if a["outlook_level"] == "red"]
        prio = ", ".join(p["id"] for p in result["priorities"])
        _notify(f"WATER ALERT: {len(escalated_points)} water points changed.\n"
                f"Warning: {', '.join(red) or '-'}\nWatch: {', '.join(yellow) or '-'}\n"
                f"Getting worse soon: {', '.join(outlook) or '-'}\n"
                f"Test today: {prio}")
    return result


# ----------------------------------------------------------------- ingest --
@app.event_hub_message_trigger(arg_name="event", event_hub_name="%IOTHUB_EH_NAME%",
                               connection="IOTHUB_EH_CONN", consumer_group="functions")
def ingest(event: func.EventHubEvent):
    try:
        body = json.loads(event.get_body().decode("utf-8"))
    except Exception:
        logging.warning("Ignoring non-JSON message")
        return
    readings = body["readings"] if isinstance(body, dict) and "readings" in body else [body]
    tc = _table()
    for r in readings:
        pid = r.get("point_id")
        if pid not in logic.POINTS:
            logging.warning("Unknown point_id %s", pid)
            continue
        st = logic.update_state(_get(tc, "point", pid), r, logic.POINTS[pid])
        _put(tc, "point", pid, st)
        _put_history(tc, pid, st)
    _refresh_and_notify(tc)


# ---------------------------------------------------------------- history --
def _put_history(tc, pid, st):
    """One row per reading. RowKey = inverted timestamp, so newest rows come first."""
    try:
        ms = int(logic.parse_ts(st["last_seen"]).timestamp() * 1000)
    except Exception:
        ms = int(time.time() * 1000)
    tc.upsert_entity({
        "PartitionKey": f"hist_{pid}",
        "RowKey": f"{9999999999999 - ms:013d}",
        "ts": st["last_seen"],
        "ec_us": float(st["ec_us"]),
        "tds": int(round(st["ec_us"] * logic.EC_TO_TDS)),
        "turb_ntu": float(st.get("turb_ntu", 0)),
    }, mode=UpdateMode.REPLACE)


@app.route(route="history", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def history(req: func.HttpRequest) -> func.HttpResponse:
    pid = req.params.get("id", "")
    if pid not in logic.POINTS:
        return _json({"error": "unknown id"}, 400)
    try:
        n = max(10, min(int(req.params.get("n", "150")), 1000))
    except ValueError:
        n = 150
    rows = []
    for e in _table().query_entities(f"PartitionKey eq 'hist_{pid}'", results_per_page=n):
        rows.append({"ts": e["ts"], "tds": e["tds"], "ec_us": e["ec_us"], "turb_ntu": e["turb_ntu"]})
        if len(rows) >= n:
            break
    rows.reverse()  # oldest first for the chart
    return _json({
        "id": pid, "name": logic.POINTS[pid]["name"], "points": rows,
        "limits": {"yellow": logic.TDS_YELLOW, "human": logic.TDS_HUMAN_LIMIT,
                   "livestock": logic.TDS_LIVESTOCK_LIMIT},
    })


# ---------------------------------------------------------------- weather --
def _azure_maps_forecast(days=10):
    """10-day forecast from Azure Maps Weather (AccuWeather). None if unavailable."""
    key = os.environ.get("MAPS_KEY")
    if not key:
        return None
    url = ("https://atlas.microsoft.com/weather/forecast/daily/json?api-version=1.1"
           f"&query={WEATHER_LAT},{WEATHER_LON}&duration={days}&subscription-key={key}")
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.load(resp)
    except Exception as e:
        logging.error("Azure Maps weather failed, falling back to Open-Meteo: %s", e)
        return None

    def liquid(f, part):
        return float((((f.get(part) or {}).get("totalLiquid") or {}).get("value")) or 0)

    out = []
    for f in data.get("forecasts", []):
        out.append({
            "date": str(f.get("date", ""))[:10],
            "rain_mm": round(liquid(f, "day") + liquid(f, "night"), 1),
            "tmax": ((f.get("temperature") or {}).get("maximum") or {}).get("value"),
            "p_rain": (f.get("day") or {}).get("precipitationProbability"),
        })
    return out or None


@app.timer_trigger(schedule="0 */30 * * * *", arg_name="timer", run_on_startup=True)
def weather(timer: func.TimerRequest):
    """Past 60 days (dry spell, first flush) from Open-Meteo,
    next 10 days from Azure Maps Weather (fallback: Open-Meteo)."""
    url = ("https://api.open-meteo.com/v1/forecast"
           f"?latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
           "&daily=precipitation_sum,temperature_2m_max&past_days=60&forecast_days=10"
           "&timezone=Africa%2FNairobi")
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.load(resp)
        d = data["daily"]
        w = logic.weather_features(d["time"], d["precipitation_sum"])
        fc = _azure_maps_forecast()
        w["forecast_source"] = "azure-maps" if fc else "open-meteo"
        w["forecast"] = fc or logic.open_meteo_forecast(d["time"], d["precipitation_sum"],
                                                        d.get("temperature_2m_max"))
        w["rain_forecast_48h"] = round(sum((x.get("rain_mm") or 0) for x in w["forecast"][1:3]), 1)
        tc = _table()
        _put(tc, "weather", "current", w)
        logging.info("Weather updated (%s forecast)", w["forecast_source"])
        _refresh_and_notify(tc)
    except Exception as e:
        logging.error("Weather update failed: %s", e)


# ------------------------------------------------------------------- HTTP --
def _json(data, status=200):
    return func.HttpResponse(json.dumps(data), status_code=status, mimetype="application/json")


@app.route(route="state", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def state(req: func.HttpRequest) -> func.HttpResponse:
    return _json(_assess_all(_table()))


@app.route(route="map", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def map_page(req: func.HttpRequest) -> func.HttpResponse:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "map.html")
    with open(path, encoding="utf-8") as f:
        html = f.read().replace("__MAPS_KEY__", os.environ.get("MAPS_KEY", ""))
    return func.HttpResponse(html, mimetype="text/html")


@app.route(route="testresult", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def testresult(req: func.HttpRequest) -> func.HttpResponse:
    try:
        b = req.get_json()
        pid, test, result = b["point_id"], b["test"], b["result"]
        assert pid in logic.POINTS and result in ("positive", "negative")
    except Exception:
        return _json({"error": "send point_id, test (h2s|cbt|salt_kit), result (positive|negative)"}, 400)
    tc = _table()
    st = _get(tc, "point", pid)
    now = datetime.now(timezone.utc).isoformat()
    st["last_test"] = {"test": test, "result": result, "ts": now}
    st["last_test_ts"] = now
    _put(tc, "point", pid, st)
    _notify(f"Test result received: {pid} {test.upper()} {result}.")
    return _json(_refresh_and_notify(tc))


def _demo_forecast(rains, tmax):
    """Fake 10-day forecast starting today, for the demo buttons."""
    from datetime import timedelta
    today = datetime.now(timezone.utc).date()
    return [{"date": (today + timedelta(days=i)).isoformat(), "rain_mm": r, "tmax": t, "p_rain": None}
            for i, (r, t) in enumerate(zip(rains, tmax))]


PRESETS = {
    "heavy_rain": {"rain_72h": 35, "dry_spell_before_rain": 40, "dry_days": 0, "rain_forecast_48h": 0,
                   "forecast": _demo_forecast([4, 2, 0, 0, 0, 1, 0, 0, 0, 0], [31] * 10)},
    "forecast":   {"rain_72h": 0, "dry_spell_before_rain": 0, "dry_days": 40, "rain_forecast_48h": 30,
                   "forecast": _demo_forecast([0, 22, 8, 3, 0, 0, 0, 0, 0, 0], [35, 33, 30, 31, 33, 34, 35, 35, 36, 36])},
    "dry":        {"rain_72h": 0, "dry_spell_before_rain": 0, "dry_days": 60, "rain_forecast_48h": 0,
                   "forecast": _demo_forecast([0] * 10, [37, 38, 38, 39, 39, 38, 39, 40, 39, 38])},
}


@app.route(route="simulate", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def simulate(req: func.HttpRequest) -> func.HttpResponse:
    try:
        preset = req.get_json().get("preset", "reset")
    except Exception:
        preset = "reset"
    tc = _table()
    if preset == "reset":
        _put(tc, "weather", "override", {"active": False})
    elif preset in PRESETS:
        _put(tc, "weather", "override", {"active": True, "source": f"demo:{preset}", **PRESETS[preset]})
    else:
        return _json({"error": f"unknown preset {preset}"}, 400)
    return _json(_refresh_and_notify(tc))
