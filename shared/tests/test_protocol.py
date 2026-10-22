"""The shared protocol and limits: one source for the Pi, the cloud and the animations."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

import leds
import logic
import sensors

SHARED = Path(__file__).resolve().parents[1]
SCHEMAS = {p.name: json.loads(p.read_text(encoding="utf-8")) for p in (SHARED / "protocol").glob("*.schema.json")}
REGISTRY = Registry().with_resources((s["$id"], Resource.from_contents(s)) for s in SCHEMAS.values())
LIMITS = json.loads((SHARED / "limits.json").read_text(encoding="utf-8"))


def validate(schema_name, data):
    Draft202012Validator(SCHEMAS[schema_name], registry=REGISTRY).validate(data)


@pytest.mark.parametrize("name, example", [
    ("batch.schema.json", "pi-batch.json"),
    ("batch.schema.json", "simulator-batch.json"),
    ("twin.schema.json", "twin.json"),
])
def test_examples_match_the_schemas(name, example):
    validate(name, json.loads((SHARED / "protocol" / "examples" / example).read_text(encoding="utf-8")))


def test_a_pi_measurement_matches_the_schema(monkeypatch):
    monkeypatch.setattr(sensors, "read_voltage", lambda ch, samples=25, delay=0.01: [0.76, 1.0, 1.43][ch])
    m = {"deviceId": "wp07", "point_id": "wp07", "ts": "2026-10-16T19:30:00Z", **sensors.read_all(ratio=2.0)}
    validate("batch.schema.json", {"readings": [m]})


def test_the_cloud_understands_every_field_name_the_schema_allows():
    props = SCHEMAS["reading.schema.json"]["properties"]
    for long_name, short_name in logic.FIELD_ALIASES.items():
        assert long_name in props and short_name in props


def test_pi_and_cloud_use_the_shared_limits():
    assert (leds.TDS_YELLOW, leds.TDS_RED) == (LIMITS["tds_ppm"]["yellow"], LIMITS["tds_ppm"]["red"])
    assert (logic.TDS_YELLOW, logic.TDS_HUMAN_LIMIT) == (LIMITS["tds_ppm"]["yellow"], LIMITS["tds_ppm"]["red"])
    assert logic.TDS_LIVESTOCK_LIMIT == LIMITS["tds_ppm"]["livestock_red"]
    assert leds.PH_OK == logic.PH_OK == (LIMITS["ph"]["min"], LIMITS["ph"]["max"])
    assert leds.TURBIDITY_YELLOW_NTU == LIMITS["turbidity_ntu"]["yellow"]
