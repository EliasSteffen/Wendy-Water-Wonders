"""Azure Functions (Python v2 model) for Wendy's Water Wonder.

Endpoints / triggers
  ingest        IoT Hub trigger: stores readings, re-assesses, sends alerts
  weather       Timer (every 30 min): rain features from Open-Meteo
  GET  /api/state       all water points + alternatives + test priorities (JSON)
  GET  /api/map         the Azure Maps page
  GET  /api/history?id=wp07&n=150   salt history of one point (for the trend chart)
  POST /api/testresult  {"point_id":"wp07","test":"h2s|cbt|salt_kit","result":"positive|negative"}
  POST /api/simulate    {"preset":"heavy_rain|forecast|dry|reset"}  (demo weather override)
  POST /api/reset       {"point_id":"wp07","by":"Wendy","checked":true}  switch the station's
                        warning lights off (human in the loop: only from the dashboard button)
  POST /api/clear       {"point_id":"wp05"|"all"}  dashboard "Reset": forget tests, manual colour,
                        salt trend and alert memory ("all" also ends the demo weather)
  POST /api/override    {"point_id":"wp05","level":"none|yellow|red"}  set a colour by hand (demo, no SMS)
"""

import base64
import hashlib
import hmac
import html
import json
import logging
import os
import re
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

import azure.functions as func
from azure.data.tables import TableServiceClient, UpdateMode

import logic

app = func.FunctionApp()

TABLE_NAME = "wendystate"
WEATHER_LAT, WEATHER_LON = 3.12, 35.60  # Lodwar, reference for all points
REAL_DEVICES = [
    d.strip() for d in os.environ.get("REAL_DEVICE_IDS", "wp07").split(",") if d.strip()
]


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
    tc.upsert_entity(
        {"PartitionKey": pk, "RowKey": rk, "data": json.dumps(data)}, mode=UpdateMode.REPLACE
    )


def _weather(tc):
    w = _get(tc, "weather", "current")
    ov = _get(tc, "weather", "override")
    if ov.get("active"):
        w = {**w, **ov}
    return w


def _assess_all(tc):
    states = {
        e["RowKey"]: json.loads(e.get("data", "{}"))
        for e in tc.query_entities("PartitionKey eq 'point'")
    }
    weather = _weather(tc)
    return {
        **logic.assess_all(states, weather, REAL_DEVICES),
        "weather": weather,
        "generated": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------- notifications --
def _http_error(e):
    """Readable error text incl. the provider's response body (e.g. Twilio's reason)."""
    body = ""
    if hasattr(e, "read"):
        try:
            body = e.read().decode("utf-8", "ignore")[:300]
        except Exception:
            pass
    return f"{e} {body}".strip()


def _sms_budget_ok(n):
    """Daily SMS cap (SMS_MAX_PER_DAY, default 20) so demos don't burn the trial credit."""
    limit = int(os.environ.get("SMS_MAX_PER_DAY", "20"))
    try:
        tc = _table()
        key = "sms_" + datetime.now(timezone.utc).strftime("%Y%m%d")
        count = int(_get(tc, "meta", key).get("count", 0))
        if count + n > limit:
            return False
        _put(tc, "meta", key, {"count": count + n})
    except Exception as e:
        logging.warning("SMS budget check failed (sending anyway): %s", e)
    return True


def _wells(text):
    """Names shown to people: wp05 -> well05 (IDs inside the system stay wp05)."""
    return re.sub(r"\bwp(\d+)\b", r"well\1", text)


def _send_sms_acs(text, numbers):
    """SMS via Azure Communication Services with an alphanumeric sender ID (e.g. "WendyWater").
    Germany only supports dynamic alphanumeric sender IDs, no phone numbers."""
    try:
        from azure.communication.sms import SmsClient  # imported lazily on purpose

        client = SmsClient.from_connection_string(os.environ["ACS_CONNECTION_STRING"])
        results = client.send(from_=os.environ["ACS_SMS_FROM"], to=numbers, message=text)
        out = []
        for r in results:
            if r.successful:
                out.append(f"{r.to}: sent (azure)")
            else:
                logging.error(
                    "ACS SMS to %s failed: %s %s", r.to, r.http_status_code, r.error_message
                )
                out.append(f"{r.to}: error {r.http_status_code} {r.error_message}")
        return "; ".join(out)
    except Exception as e:
        logging.error("ACS SMS failed: %s", e)
        return f"error (azure) {e}"


def _send_sms(text):
    """Channel 1: SMS, only for urgent alerts.
    Uses Azure Communication Services if ACS_SMS_FROM is set, otherwise Twilio."""
    text = _wells(text)
    to = os.environ.get("ALERT_SMS_TO")
    use_acs = bool(os.environ.get("ACS_SMS_FROM") and os.environ.get("ACS_CONNECTION_STRING"))
    sid, tok, frm = (
        os.environ.get("TWILIO_SID"),
        os.environ.get("TWILIO_TOKEN"),
        os.environ.get("TWILIO_FROM"),
    )
    if not to or not (use_acs or all((sid, tok, frm))):
        return "not configured"
    numbers = [n.strip() for n in to.split(",") if n.strip()]
    if not _sms_budget_ok(len(numbers)):
        return "skipped (daily SMS cap reached)"
    if use_acs:
        return _send_sms_acs(text, numbers)
    auth = base64.b64encode(f"{sid}:{tok}".encode()).decode()
    results = []
    for number in numbers:
        data = urllib.parse.urlencode({"To": number, "From": frm, "Body": text[:1500]}).encode()
        req = urllib.request.Request(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            data=data,
            headers={"Authorization": f"Basic {auth}"},
        )
        try:
            urllib.request.urlopen(req, timeout=10)
            results.append(f"{number}: sent")
        except Exception as e:
            logging.error("SMS to %s failed: %s", number, _http_error(e))
            results.append(f"{number}: error {_http_error(e)}")
    return "; ".join(results)


def _send_email(text):
    """Channel 2: e-mail via Azure Communication Services (Azure-native)."""
    text = _wells(text)
    conn = os.environ.get("ACS_CONNECTION_STRING")
    sender, to = os.environ.get("ACS_EMAIL_SENDER"), os.environ.get("ALERT_EMAIL_TO")
    if not all((conn, sender, to)):
        return "not configured"
    try:
        from azure.communication.email import EmailClient  # imported lazily on purpose

        client = EmailClient.from_connection_string(conn)
        lines = text.splitlines()
        message = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": a.strip()} for a in to.split(",") if a.strip()]},
            "content": {
                "subject": f"[Wendy's Water Wonder] {lines[0][:100] if lines else 'Alert'}",
                "plainText": text,
                "html": "<div style='font-family:Segoe UI,Arial,sans-serif;font-size:15px'>"
                + "<br>".join(html.escape(line) for line in lines)
                + "</div>",
            },
        }
        client.begin_send(message)  # the request is sent here; no need to wait for the poller
        return "sent"
    except Exception as e:
        logging.error("Email failed: %s", e)
        return f"error {e}"


def _send_telegram(text):
    """Optional channel 3: Telegram bot."""
    text = _wells(text)
    tok, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (tok and chat):
        return "not configured"
    data = urllib.parse.urlencode({"chat_id": chat, "text": text}).encode()
    try:
        urllib.request.urlopen(
            f"https://api.telegram.org/bot{tok}/sendMessage", data=data, timeout=10
        )
        return "sent"
    except Exception as e:
        logging.error("Telegram failed: %s", _http_error(e))
        return f"error {_http_error(e)}"


def _notify(text, sms=None, urgent=True):
    """Send the alert over every configured channel (redundancy).
    SMS gets a short version and is only used for urgent (red) alerts."""
    logging.info("ALERT (urgent=%s):\n%s", urgent, text)
    return {
        "sms": _send_sms(sms or text[:150]) if urgent else "skipped (not urgent)",
        "email": _send_email(text),
        "telegram": _send_telegram(text),
    }


# ------------------------------------------------------------ device twin --
def _update_twin(device_id, desired):
    """Write desired properties via the IoT Hub REST API (no extra SDK needed). True if it worked."""
    cs = os.environ.get("IOTHUB_SERVICE_CONN")
    if not cs:
        return False
    parts = dict(p.split("=", 1) for p in cs.split(";") if p)
    host, key_name, key = parts["HostName"], parts["SharedAccessKeyName"], parts["SharedAccessKey"]
    expiry = int(time.time()) + 3600
    uri = urllib.parse.quote_plus(host)
    sig = base64.b64encode(
        hmac.new(base64.b64decode(key), f"{uri}\n{expiry}".encode(), hashlib.sha256).digest()
    )
    token = f"SharedAccessSignature sr={uri}&sig={urllib.parse.quote_plus(sig)}&se={expiry}&skn={key_name}"
    req = urllib.request.Request(
        f"https://{host}/twins/{device_id}?api-version=2021-04-12",
        data=json.dumps({"properties": {"desired": desired}}).encode(),
        method="PATCH",
        headers={"Authorization": token, "Content-Type": "application/json", "If-Match": "*"},
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        logging.error("Twin update failed for %s: %s", device_id, e)
        return False


# ------------------------------------------------------------- SMS rules --
# SMS only when salt is really high, confirmed by several readings in a row, and
# (by default) only for the real station. Everything else goes by e-mail/Telegram.
def _sms_salt_min():
    return float(os.environ.get("SMS_SALT_MIN_TDS", "800"))  # ppm (mg/L)


def _sms_confirm():
    return max(1, int(os.environ.get("SMS_SALT_CONFIRM", "2")))  # readings in a row


def _sms_points():
    v = os.environ.get("SMS_POINTS", ",".join(REAL_DEVICES)).strip()
    return None if v.lower() == "all" else {p.strip() for p in v.split(",") if p.strip()}


def _sms_condition(a):
    pts = _sms_points()
    return (
        not a["no_data"]
        and (a["tds"] or 0) >= _sms_salt_min()
        and a.get("high_salt_streak", 0) >= _sms_confirm()
        and (pts is None or a["id"] in pts)
    )


def _manual_leds(a):
    if not a.get("manual"):
        return {}
    return {
        "salt": "red" if a["level"] == "red" else "none",
        "germs": "yellow" if a["level"] == "yellow" else "none",
    }


def _refresh_and_notify(tc):
    """Re-assess everything; alert only when a point gets worse; push twin updates."""
    result = _assess_all(tc)
    weather = result["weather"]
    escalated_points = []
    for a in result["points"]:
        prev = _get(tc, "notify", a["id"])
        cur = {
            "level": a["level"],
            "salt": a["salt"],
            "germs": a["germs"],
            "outlook": a["outlook_level"],
            "alt": (a["alternative"] or {}).get("id"),
            "sms_salt": _sms_condition(a),
        }
        first_time = not prev
        # SMS once when the high-salt condition starts (re-armed when it ends)
        if cur["sms_salt"] and not prev.get("sms_salt") and not first_time:
            alt = a["alternative"] or logic.best_alternative(a, result["points"], "salt")
            logging.info("High salt at %s -> SMS: %s", a["id"], _send_sms(logic.sms_salt(a, alt)))
        escalated = not first_time and (
            logic.LEVELS.index(a["salt"]) > logic.LEVELS.index(prev.get("salt", "none"))
            or logic.LEVELS.index(a["germs"]) > logic.LEVELS.index(prev.get("germs", "none"))
            or (a["outlook_level"] == "red" and prev.get("outlook", "none") != "red")
        )
        if escalated and (a["level"] in ("yellow", "red") or a["outlook_level"] == "red"):
            escalated_points.append(a)
        if a["id"] in REAL_DEVICES and (first_time or cur != prev):
            _update_twin(
                a["id"],
                {
                    "alternative": a["alternative"],
                    "use": a["use"],
                    "salt": a["salt"],  # the Pi's LEDs: salt red -> red, germ risk -> yellow
                    "germs": a["germs"],
                    **_manual_leds(a),  # colour set by hand on the dashboard drives the LEDs too
                    "level": a["level"],
                    "advice": a["advice"][:3],
                    "rain_forecast_48h": weather.get("rain_forecast_48h", 0),
                    "dry_days": weather.get("dry_days", 0),
                    "updated": result["generated"],
                },
            )
        if first_time or cur != prev:
            _put(tc, "notify", a["id"], cur)

    # E-mail/Telegram for every escalation (SMS is handled above, only for high salt).
    # Few changes -> one message each, many changes -> one summary (no flood).
    if 0 < len(escalated_points) <= 2:
        for a in escalated_points:
            _notify(logic.message_for(a), urgent=False)
    elif len(escalated_points) > 2:
        red = [a["id"] for a in escalated_points if a["level"] == "red"]
        yellow = [a["id"] for a in escalated_points if a["level"] == "yellow"]
        outlook = [a["id"] for a in escalated_points if a["outlook_level"] == "red"]
        prio = ", ".join(p["id"] for p in result["priorities"])
        _notify(
            f"WATER ALERT: {len(escalated_points)} water points changed.\n"
            f"Warning: {', '.join(red) or '-'}\nWatch: {', '.join(yellow) or '-'}\n"
            f"Getting worse soon: {', '.join(outlook) or '-'}\n"
            f"Test today: {prio}",
            urgent=False,
        )
    return result


# ----------------------------------------------------------------- ingest --
@app.event_hub_message_trigger(
    arg_name="event",
    event_hub_name="%IOTHUB_EH_NAME%",
    connection="IOTHUB_EH_CONN",
    consumer_group="functions",
)
def ingest(event: func.EventHubEvent):
    try:
        body = json.loads(event.get_body().decode("utf-8"))
    except Exception:
        logging.warning("Ignoring non-JSON message")
        return
    readings = body["readings"] if isinstance(body, dict) and "readings" in body else [body]
    # Fallback if a message has no point_id: use the IoT Hub device id (e.g. "wp07")
    device_id = (getattr(event, "iothub_metadata", None) or {}).get("connection-device-id")
    tc = _table()
    for r in readings:
        r = logic.normalize_reading(r)
        pid = r.get("point_id") or (device_id if device_id in logic.POINTS else None)
        if pid not in logic.POINTS:
            logging.warning("Unknown point_id %s (device %s)", pid, device_id)
            continue
        st = logic.update_state(_get(tc, "point", pid), r, logic.POINTS[pid])
        # Count readings in a row with really high salt (for the SMS rule)
        ec = r.get("ec_us")
        if ec is not None and float(ec) >= logic.MIN_VALID_EC:
            high = float(ec) * logic.EC_TO_TDS >= _sms_salt_min()
            st["high_salt_streak"] = int(st.get("high_salt_streak", 0)) + 1 if high else 0
        _put(tc, "point", pid, st)
        if "ec_us" in st:
            _put_history(tc, pid, st)
    _refresh_and_notify(tc)


# ---------------------------------------------------------------- history --
def _put_history(tc, pid, st):
    """One row per reading. RowKey = inverted timestamp, so newest rows come first."""
    try:
        ms = int(logic.parse_ts(st["last_seen"]).timestamp() * 1000)
    except Exception:
        ms = int(time.time() * 1000)
    row = {
        "PartitionKey": f"hist_{pid}",
        "RowKey": f"{9999999999999 - ms:013d}",
        "ts": st["last_seen"],
        "ec_us": float(st["ec_us"]),
        "tds": int(round(st["ec_us"] * logic.EC_TO_TDS)),
        "turb_ntu": float(st.get("turb_ntu", 0)),
    }
    for k in ("turb_last", "ph"):  # raw sensor values for the chart; missing = not measured
        if st.get(k) is not None:
            row[k] = float(st[k])
    tc.upsert_entity(row, mode=UpdateMode.REPLACE)


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
        rows.append(
            {
                "ts": e["ts"],
                "tds": e["tds"],
                "ec_us": e["ec_us"],
                "turb_ntu": e["turb_ntu"],
                "turb": e.get("turb_last"),
                "ph": e.get("ph"),
            }
        )
        if len(rows) >= n:
            break
    rows.reverse()  # oldest first for the chart
    return _json(
        {
            "id": pid,
            "name": logic.POINTS[pid]["name"],
            "points": rows,
            "limits": {
                "yellow": logic.TDS_YELLOW,
                "human": logic.TDS_HUMAN_LIMIT,
                "livestock": logic.TDS_LIVESTOCK_LIMIT,
                "ph": list(logic.PH_OK),
            },
        }
    )


# ---------------------------------------------------------------- weather --
def _azure_maps_forecast(days=10):
    """10-day forecast from Azure Maps Weather (AccuWeather). None if unavailable."""
    key = os.environ.get("MAPS_KEY")
    if not key:
        return None
    url = (
        "https://atlas.microsoft.com/weather/forecast/daily/json?api-version=1.1"
        f"&query={WEATHER_LAT},{WEATHER_LON}&duration={days}&subscription-key={key}"
    )
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
        out.append(
            {
                "date": str(f.get("date", ""))[:10],
                "rain_mm": round(liquid(f, "day") + liquid(f, "night"), 1),
                "tmax": ((f.get("temperature") or {}).get("maximum") or {}).get("value"),
                "p_rain": (f.get("day") or {}).get("precipitationProbability"),
            }
        )
    return out or None


@app.timer_trigger(schedule="0 */30 * * * *", arg_name="timer", run_on_startup=True)
def weather(timer: func.TimerRequest):
    """Past 60 days (dry spell, first flush) from Open-Meteo,
    next 10 days from Azure Maps Weather (fallback: Open-Meteo)."""
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={WEATHER_LAT}&longitude={WEATHER_LON}"
        "&daily=precipitation_sum,temperature_2m_max&past_days=60&forecast_days=10"
        "&timezone=Africa%2FNairobi"
    )
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.load(resp)
        d = data["daily"]
        w = logic.weather_features(d["time"], d["precipitation_sum"])
        fc = _azure_maps_forecast()
        w["forecast_source"] = "azure-maps" if fc else "open-meteo"
        w["forecast"] = fc or logic.open_meteo_forecast(
            d["time"], d["precipitation_sum"], d.get("temperature_2m_max")
        )
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
    result = _assess_all(_table())
    result["stations"] = REAL_DEVICES  # points with a real station (LEDs, reset button)
    return _json(result)


@app.route(route="map", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def map_page(req: func.HttpRequest) -> func.HttpResponse:
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "map.html")
    with open(path, encoding="utf-8") as f:
        html = f.read().replace("__MAPS_KEY__", os.environ.get("MAPS_KEY", ""))
    return func.HttpResponse(html, mimetype="text/html")


@app.route(route="testalert", methods=["GET", "POST"], auth_level=func.AuthLevel.ANONYMOUS)
def testalert(req: func.HttpRequest) -> func.HttpResponse:
    """Sends one test message over all channels and reports what happened per channel."""
    status = _notify(
        "TEST ALERT from Wendy's Water Wonder.\n"
        "If you can read this, this channel works.\n"
        f"Sent {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC",
        sms="TEST from Wendy's Water Wonder: SMS works.",
        urgent=True,
    )
    return _json(status)


def _reset_point(tc, pid):
    """Back to a calm state: forget tests, manual colour, trend and alert memory."""
    st = _get(tc, "point", pid)
    for k in ("last_test", "last_test_ts", "override", "high_salt_streak", "turb_ntu"):
        st.pop(k, None)
    if "ec_us" in st:
        st["ec_slow"] = st["ec_slow_before"] = st["ec_us"]  # current value becomes the new normal
    _put(tc, "point", pid, st)
    try:
        tc.delete_entity("notify", pid)  # next evaluation counts as "first time": no alert, no SMS
    except Exception:
        pass


@app.route(route="clear", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def clear_point(req: func.HttpRequest) -> func.HttpResponse:
    """Dashboard "Reset": {"point_id": "wp07"} resets one point, {"point_id": "all"} resets everything incl. demo weather."""
    try:
        pid = req.get_json().get("point_id", "all")
    except Exception:
        pid = "all"
    tc = _table()
    if pid == "all":
        for p in logic.POINTS:
            _reset_point(tc, p)
        _put(tc, "weather", "override", {"active": False})
    elif pid in logic.POINTS:
        _reset_point(tc, pid)
    else:
        return _json({"error": "unknown point_id"}, 400)
    return _json(_refresh_and_notify(tc))


@app.route(route="override", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def override(req: func.HttpRequest) -> func.HttpResponse:
    """{"point_id": "wp07", "level": "none|yellow|red"}: set the colour by hand (demo)."""
    try:
        b = req.get_json()
        pid, level = b["point_id"], b["level"]
        assert pid in logic.POINTS and level in logic.LEVELS
    except Exception:
        return _json({"error": "send point_id and level (none|yellow|red)"}, 400)
    tc = _table()
    st = _get(tc, "point", pid)
    st["override"] = {"level": level, "ts": datetime.now(timezone.utc).isoformat()}
    _put(tc, "point", pid, st)
    return _json(_refresh_and_notify(tc))  # pushes the colour to a live station's LEDs


@app.route(route="testresult", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def testresult(req: func.HttpRequest) -> func.HttpResponse:
    try:
        b = req.get_json()
        pid, test, result = b["point_id"], b["test"], b["result"]
        assert pid in logic.POINTS and result in ("positive", "negative")
    except Exception:
        return _json(
            {"error": "send point_id, test (h2s|cbt|salt_kit), result (positive|negative)"}, 400
        )
    tc = _table()
    st = _get(tc, "point", pid)
    now = datetime.now(timezone.utc).isoformat()
    st["last_test"] = {"test": test, "result": result, "ts": now}
    st["last_test_ts"] = now
    _put(tc, "point", pid, st)
    _notify(f"Test result received: {pid} {test.upper()} {result}.", urgent=False)
    return _json(_refresh_and_notify(tc))


@app.route(route="reset", methods=["POST"], auth_level=func.AuthLevel.ANONYMOUS)
def reset_water(req: func.HttpRequest) -> func.HttpResponse:
    """Dashboard button "Reset water": a person who checked the water point switches the
    station's yellow/red lights off. The station never does this by itself (human in the loop).
    Goes through the device twin, so a station that is offline gets it when it reconnects."""
    try:
        b = req.get_json()
        pid, by = b["point_id"], str(b.get("by", "")).strip()[:40]
        assert pid in REAL_DEVICES and by and b.get("checked") is True
    except Exception:
        return _json({"error": "send point_id (a station), by (your name) and checked: true"}, 400)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not _update_twin(pid, {"reset_water": {"id": uuid.uuid4().hex[:12], "by": by, "ts": ts}}):
        return _json({"error": "could not reach the IoT Hub, try again"}, 502)
    logging.info("Station %s lights reset by %s", pid, by)
    _notify(f"{pid}: station lights reset by {by} ({ts}).", urgent=False)
    return _json({"ok": True, "point_id": pid, "by": by, "ts": ts})


def _demo_forecast(rains, tmax):
    """Fake 10-day forecast starting today, for the demo buttons."""
    from datetime import timedelta

    today = datetime.now(timezone.utc).date()
    return [
        {"date": (today + timedelta(days=i)).isoformat(), "rain_mm": r, "tmax": t, "p_rain": None}
        for i, (r, t) in enumerate(zip(rains, tmax))
    ]


PRESETS = {
    "heavy_rain": {
        "rain_72h": 35,
        "dry_spell_before_rain": 40,
        "dry_days": 0,
        "rain_forecast_48h": 0,
        "forecast": _demo_forecast([4, 2, 0, 0, 0, 1, 0, 0, 0, 0], [31] * 10),
    },
    "forecast": {
        "rain_72h": 0,
        "dry_spell_before_rain": 0,
        "dry_days": 40,
        "rain_forecast_48h": 30,
        "forecast": _demo_forecast(
            [0, 22, 8, 3, 0, 0, 0, 0, 0, 0], [35, 33, 30, 31, 33, 34, 35, 35, 36, 36]
        ),
    },
    "dry": {
        "rain_72h": 0,
        "dry_spell_before_rain": 0,
        "dry_days": 60,
        "rain_forecast_48h": 0,
        "forecast": _demo_forecast([0] * 10, [37, 38, 38, 39, 39, 38, 39, 40, 39, 38]),
    },
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
        _put(
            tc,
            "weather",
            "override",
            {"active": True, "source": f"demo:{preset}", **PRESETS[preset]},
        )
    else:
        return _json({"error": f"unknown preset {preset}"}, 400)
    return _json(_refresh_and_notify(tc))
