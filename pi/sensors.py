"""Shared sensor code for the water-quality station (Raspberry Pi 5 + MCP3008).

Wiring (see CLAUDE.md, don't change without checking the breadboard):
  CH0  TDS meter (CQRobot), 0-2.3 V, no divider
  CH1  Turbidity sensor via voltage divider (sensor outputs up to 4.5 V)
  CH2  pH meter (DFRobot Gravity V2), 0-3.0 V, no divider
  MCP3008 on SPI0 CE0, VDD = VREF = 3.3 V, 10-bit

Import this from tds_test.py, turbidity_test.py, ph_test.py and uploader.py
instead of copying the conversion formulas.
"""
import statistics
import time
import warnings

VREF = 3.3
TDS_CHANNEL = 0
TURBIDITY_CHANNEL = 1
PH_CHANNEL = 2

# Below these ADC voltages we treat the sensor as "not in water / not connected"
TDS_MIN_V = 0.01
TURBIDITY_MIN_V = 0.05
PH_MIN_V = 0.05

# Turbidity readings up to 5 % below the clear-water reference still count as clear: the probe
# is an infrared light barrier with an open gap, so room light and ADC steps move it a little
TURBIDITY_CLEAR_DEADBAND = 0.05

_adc = {}


def _channel(ch):
    """Lazily create the MCP3008 channel so this module also imports on a laptop."""
    if ch not in _adc:
        try:
            from gpiozero.exc import PinFactoryFallback
            warnings.simplefilter("ignore", PinFactoryFallback)   # harmless for SPI
        except ImportError:
            pass
        from gpiozero import MCP3008
        _adc[ch] = MCP3008(channel=ch)
    return _adc[ch]


def read_voltage(ch, samples=25, delay=0.01):
    """Median of `samples` reads, as voltage at the ADC pin."""
    adc = _channel(ch)
    values = []
    for _ in range(samples):
        values.append(adc.value * VREF)
        time.sleep(delay)
    return statistics.median(values)


# --------------------------------------------------------------------- TDS --
def tds_from_voltage(v, temp_c=25.0, k=1.0):
    """DFRobot GravityTDS method. Returns (ec25 in uS/cm, tds in ppm) or (None, None)."""
    if v is None or v < TDS_MIN_V:
        return None, None                       # probe not in water
    ec_raw = 133.42 * v ** 3 - 255.86 * v ** 2 + 857.39 * v
    ec25 = ec_raw * k / (1 + 0.02 * (temp_c - 25))
    return round(ec25, 1), round(ec25 * 0.5, 1)


# --------------------------------------------------------------- turbidity --
def turbidity_from_voltage(v_adc, ratio, clear_v=None):
    """Returns (ntu, v_sensor, note). ntu is None if the reading is implausible.

    NTU formula (DFRobot) is only valid for 2.5-4.2 V at the sensor:
      >= 4.2 V -> 0 NTU, < 2.5 V -> very turbid (reported as 3000, note "over_range").
    clear_v = sensor voltage in clear water (`uploader.py --calibrate-turbidity`). Each sensor
    gives a different voltage in clear water, so the reading is scaled to put clear water at
    the formula's 0 NTU point (4.2 V); within TURBIDITY_CLEAR_DEADBAND below it is still clear.
    """
    if v_adc is None or v_adc < TURBIDITY_MIN_V:
        return None, v_adc, "no_signal"          # wiring problem: send null, never crash
    v = v_adc * ratio
    v_curve = v
    if clear_v:
        rel = v / clear_v                        # 1.0 = as clear as the calibration water
        if rel >= 1 - TURBIDITY_CLEAR_DEADBAND:
            return 0.0, round(v, 3), "ok"
        v_curve = 4.2 * rel / (1 - TURBIDITY_CLEAR_DEADBAND)
    if v_curve >= 4.2:
        return 0.0, round(v, 3), "ok"
    if v_curve < 2.5:
        return 3000.0, round(v, 3), "over_range"
    ntu = -1120.4 * v_curve ** 2 + 5742.3 * v_curve - 4352.9
    return round(max(ntu, 0.0), 1), round(v, 3), "ok"


# ---------------------------------------------------------------------- pH --
def ph_from_voltage(v, v7=None, v4=None):
    """Two-point calibration, same maths as DFRobot's DFRobot_PH library.
    v7/v4 = voltage in pH 7.0 / pH 4.0 buffer (from `ph_test.py --calibrate`).
    Returns (ph, note). ph is None if not calibrated, no signal or implausible."""
    if v is None or v < PH_MIN_V:
        return None, "no_signal"                 # board never outputs ~0 V in water
    if v7 is None or v4 is None or abs(v7 - v4) < 0.05:
        return None, "not_calibrated"            # ph_v is still sent, pH can be recomputed later
    ph = 7.0 + (v - v7) * 3.0 / (v7 - v4)
    if not 0.0 <= ph <= 14.0:
        return None, "out_of_range"
    return round(ph, 2), "ok"


def read_all(samples=25, ratio=1.5, temp_c=25.0, k=1.0, ph_v7=None, ph_v4=None, turb_clear_v=None):
    """One complete measurement. Any failing sensor becomes None instead of an exception.
    The sensors are read one after another (the TDS probe can disturb the pH probe)."""
    out = {"tds_v": None, "ec_us_cm": None, "tds_ppm": None,
           "turbidity_v": None, "turbidity_ntu": None, "turbidity_note": None,
           "ph_v": None, "ph": None, "ph_note": None,
           "water_temp_c": temp_c}
    try:
        v = read_voltage(TDS_CHANNEL, samples)
        out["tds_v"] = round(v, 3)
        out["ec_us_cm"], out["tds_ppm"] = tds_from_voltage(v, temp_c, k)
    except Exception as e:
        out["tds_error"] = str(e)
    try:
        v = read_voltage(TURBIDITY_CHANNEL, samples)
        out["turbidity_ntu"], out["turbidity_v"], out["turbidity_note"] = turbidity_from_voltage(v, ratio, turb_clear_v)
    except Exception as e:
        out["turbidity_error"] = str(e)
    try:
        v = read_voltage(PH_CHANNEL, samples)
        out["ph_v"] = round(v, 3)
        out["ph"], out["ph_note"] = ph_from_voltage(v, ph_v7, ph_v4)
    except Exception as e:
        out["ph_error"] = str(e)
    return out
