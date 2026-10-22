"""Conversions in pi/sensors.py: pure maths, no hardware needed."""
import pytest

import sensors


def test_tds_dry_probe_is_none():
    assert sensors.tds_from_voltage(None) == (None, None)
    assert sensors.tds_from_voltage(0.0) == (None, None)


def test_tds_matches_the_value_sent_during_the_hackathon():
    # 0.76 V in tap water gave 562 uS/cm and 281 ppm on the Pi
    assert sensors.tds_from_voltage(0.76) == (562.4, 281.2)


def test_tds_temperature_compensation_and_calibration_factor():
    raw = sensors.raw_ec(1.0)
    ec_hot, _ = sensors.tds_from_voltage(1.0, temp_c=35.0)
    assert ec_hot == pytest.approx(raw / 1.2, abs=0.1)
    ec_k, tds_k = sensors.tds_from_voltage(1.0, k=2.0)
    assert ec_k == pytest.approx(2 * raw, abs=0.1)
    assert tds_k == pytest.approx(ec_k * sensors.TDS_FACTOR, abs=0.1)


@pytest.mark.parametrize("v_adc", [None, 0.0, 0.04])
def test_turbidity_without_signal_is_none(v_adc):
    ntu, _, note = sensors.turbidity_from_voltage(v_adc, ratio=2.0)
    assert ntu is None and note == "no_signal"


def test_turbidity_uncalibrated_uses_the_dfrobot_curve():
    assert sensors.turbidity_from_voltage(2.2, ratio=2.0) == (0.0, 4.4, "ok")
    assert sensors.turbidity_from_voltage(1.0, ratio=2.0) == (3000.0, 2.0, "over_range")
    assert sensors.turbidity_from_voltage(1.9, ratio=2.0) == (1289.3, 3.8, "ok")


def test_turbidity_calibrated_clear_water_and_deadband():
    # up to 5 % darker than the calibration water still counts as clear
    assert sensors.turbidity_from_voltage(0.96, ratio=2.0, clear_v=2.0)[0] == 0.0
    darker, _, note = sensors.turbidity_from_voltage(0.85, ratio=2.0, clear_v=2.0)
    darkest, _, _ = sensors.turbidity_from_voltage(0.80, ratio=2.0, clear_v=2.0)
    assert note == "ok" and 0 < darker < darkest


def test_ph_two_point_calibration():
    assert sensors.ph_from_voltage(1.5, v7=1.5, v4=2.032) == (7.0, "ok")
    assert sensors.ph_from_voltage(2.032, v7=1.5, v4=2.032) == (4.0, "ok")


@pytest.mark.parametrize("v, v7, v4, note", [
    (0.0, 1.5, 2.032, "no_signal"),
    (1.5, None, None, "not_calibrated"),
    (1.5, 1.5, 1.52, "not_calibrated"),
    (3.2, 1.5, 2.032, "out_of_range"),
])
def test_ph_is_none_when_it_cannot_be_trusted(v, v7, v4, note):
    assert sensors.ph_from_voltage(v, v7, v4) == (None, note)


def test_read_all_turns_a_failing_sensor_into_none(monkeypatch):
    volts = {sensors.TDS_CHANNEL: 0.76, sensors.PH_CHANNEL: 1.5}

    def fake_read(ch, samples=25, delay=0.01):
        if ch not in volts:
            raise OSError("SPI read failed")
        return volts[ch]

    monkeypatch.setattr(sensors, "read_voltage", fake_read)
    m = sensors.read_all(ph_v7=1.5, ph_v4=2.032)
    assert m["tds_ppm"] == 281.2
    assert m["turbidity_ntu"] is None and "turbidity_error" in m
    assert m["ph"] == 7.0
