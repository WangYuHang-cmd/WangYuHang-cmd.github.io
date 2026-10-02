"""Shared constants and helpers for the OpenLKA web-showcase pipeline (WP3).

Runs on the lab server with the openpilot venv:
    /home/henry/Desktop/Drive/openpilot/.venv/bin/python

Imports the lab decoder *unmodified* from the Dropbox folder (never edit files there).
Everything here is read-only with respect to /data/datasets/raw.
"""
from __future__ import annotations

import collections
import csv
import datetime as _dt
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import zoneinfo

PIPELINE_VERSION = "0.1.2"  # 0.1.1 half-frame cut boundaries; 0.1.2 frames.json background sampling, make-aware line codes, GPS time, blinker events, camera-drop snapping

# ----------------------------------------------------------------------------- paths
OP_DIR = "/home/henry/Desktop/Drive/openpilot"
LAB_DIR = "/home/henry/Zhouhaoseu Dropbox/Yuhang Wang/OP_CAN_DataProcessing"
DBC_DIR = os.path.join(LAB_DIR, "DBC_files")
RAW_DIR = "/data/datasets/raw/Dataset"
ROUTE_MASTER = "/data/datasets/raw/OverView/csv/route_master.csv"
WORK_DIR = "/data/datasets/temporary/web_showcase"
CACHE_DIR = os.path.join(WORK_DIR, "cache")
CLIPS_DIR = os.path.join(WORK_DIR, "clips")
SITE_DIR = os.path.join(WORK_DIR, "site")

ROUTE_RE = re.compile(r"^[0-9a-f]{8}--|^\d{4}-")  # filters the two junk dirs (rlogs / "rlog folders")
SEG_RE = re.compile(r"^(\d+)--(rlog|qlog|qcamera\.ts)(\.zst|\.bz2)?$")

EASTERN = zoneinfo.ZoneInfo("US/Eastern")

# Video constants (probed: 526x330 H.264, 20 fps, 1200 frames per segment; mp4 PTS is based on
# timestampEof, so ffprobe start_time - timestampSof/1e9 = +0.0148 s)
VIDEO_FPS = 20
VIDEO_W, VIDEO_H = 526, 330
SOF_TO_PTS_S = 0.0148
ALIGN_TOL_S = 0.03

# Size caps (bytes) enforced by export_clip.py / build_index.py
CAPS = {
    "video": 3_000_000,
    "signals": 250_000,
    "track": 10_000,
    "frames": 90_000,
    "frames_n": 700,
    "index": 6_000,
    "hero_trace": 8_000,
    "total": 30_000_000,
}

# ----------------------------------------------------------------------------- makes
# car_dir (as in /data/datasets/raw/Dataset/<CAR_DIR>) -> make_key used by DECODERS / STOCK_SPEC
MAKE_MAP = {
    "HYUNDAI_IONIQ_5": "ioniq",
    "HYUNDAI_IONIQ_5_2022": "ioniq",
    "KIA_EV6": "kia_ev6",
    "KiaNiro2023": "niro",
    "FORD_MUSTANG_MACH_E_MK1": "mache",
    "TOYOTA_RAV4_TSS2_2023": "toyota",
    "TOYOTA_RAV4_2023": "toyota",
    "TOYOTA_CAMRY_2021": "toyota",
    "TOYOTA_CAMRY_TSS2": "toyota",
    "TESLA_AP3_MODEL_3": "tesla_model3",
    "HONDA_ACCORD_HYBRID_2018": "accord",
    "VOLKSWAGEN_TIGUAN_MK2": "volkswagen",
    # no rlogs in the dataset -> not decodable: KIA_NIRO_EV_2ND_GEN, FORD_MAVERICK_MK1, HONDA_CIVIC, TESLA_MODEL_X
}

# Display names per car_dir: (make, model)
CAR_NAMES = {
    "HYUNDAI_IONIQ_5": ("Hyundai", "Ioniq 5"),
    "HYUNDAI_IONIQ_5_2022": ("Hyundai", "Ioniq 5 (2022)"),
    "KIA_EV6": ("Kia", "EV6"),
    "KiaNiro2023": ("Kia", "Niro (2023)"),
    "FORD_MUSTANG_MACH_E_MK1": ("Ford", "Mustang Mach-E"),
    "TOYOTA_RAV4_TSS2_2023": ("Toyota", "RAV4 (2023, TSS 2.5+)"),
    "TOYOTA_RAV4_2023": ("Toyota", "RAV4 (2023)"),
    "TOYOTA_CAMRY_2021": ("Toyota", "Camry (2021)"),
    "TOYOTA_CAMRY_TSS2": ("Toyota", "Camry (TSS 2.5+)"),
    "TESLA_AP3_MODEL_3": ("Tesla", "Model 3 (AP3)"),
    "TESLA_MODEL_X": ("Tesla", "Model X"),
    "HONDA_ACCORD_HYBRID_2018": ("Honda", "Accord Hybrid (2018)"),
    "HONDA_CIVIC": ("Honda", "Civic"),
    "VOLKSWAGEN_TIGUAN_MK2": ("Volkswagen", "Tiguan (Mk2)"),
    "KIA_NIRO_EV_2ND_GEN": ("Kia", "Niro EV (2nd gen)"),
    "FORD_MAVERICK_MK1": ("Ford", "Maverick"),
}

# make_key -> (lab decoder function, lab extension dict, DBC file used by that decoder)
DECODERS = {
    "ioniq": ("ioniq_can_decoder", "IONIQ5_can_msg_dict", "hyundai_canfd.dbc"),
    "kia_ev6": ("kia_ev6_can_decoder", "EV6_can_msg_dict", "hyundai_canfd.dbc"),
    "niro": ("niro_can_decoder", "NIRO_can_msg_dict", "hyundai_canfd.dbc"),
    "mache": ("mache_can_decoder", "MACHE_msg_dict", "ford_canfd.dbc"),
    "toyota": ("toyota_can_decoder", "TOYOTA_msg_dict", "final_toyota_canfd.dbc"),
    "tesla_model3": ("tesla_model3_can_decoder", "TESLA3_can_msg_dict", "tesla-model-3.dbc"),
    "accord": ("accord_can_decoder", "ACCORD_can_msg_dict", "final_cleaned_extended_honda_accord_acc_lka.dbc"),
    "volkswagen": ("volkswagen_can_decoder", "volkswagen_can_msg_dict", "vw_mqb_2010.dbc"),
}


def make_key_for(car_dir: str) -> str | None:
    if car_dir in MAKE_MAP:
        return MAKE_MAP[car_dir]
    if car_dir.startswith("TOYOTA_"):
        return "toyota"
    if car_dir.startswith("HYUNDAI_IONIQ"):
        return "ioniq"
    return None


# ----------------------------------------------------------------------------- stock spec
# STOCK_SPEC[make_key] encodes the per-make table from the plan (WP3). A "rule" is
# {"addr": <int>, "signal": <str>, "in": [values]} and a rule list is OR-ed.
# "cols" maps the unified-schema column to (addr, signal) read on the *stock* bus (src < 128).
# "verified" is True only for specs that have been checked frame-by-frame on real data.
STOCK_SPEC = {
    "ioniq": {
        "label": "Hyundai / Kia CAN-FD (Ioniq 5, EV6, Niro)",
        "dbc": "hyundai_canfd.dbc",
        "addresses": {
            234: {"msg": "MDPS", "signals": ["LKA_ACTIVE", "LKA_FAULT", "STEERING_OUT_TORQUE", "STEERING_COL_TORQUE", "STEERING_ANGLE"]},
            298: {"msg": "LFA", "signals": ["STEER_REQ", "TORQUE_REQUEST", "LKA_ICON", "LKA_ASSIST", "LFA_BUTTON", "LKA_WARNING", "LKA_MODE"]},
            80: {"msg": "LKAS", "signals": ["STEER_REQ", "TORQUE_REQUEST", "LKA_ICON", "LKA_ASSIST", "LFA_BUTTON", "LKA_WARNING", "LKA_MODE"]},
            676: {"msg": "CAM_0x2a4", "signals": ["LEFT_LANE_LINE", "RIGHT_LANE_LINE"]},
            293: {"msg": "STEERING_SENSORS", "signals": ["STEERING_ANGLE", "STEERING_RATE"]},
        },
        "lka_on": [{"addr": 234, "signal": "LKA_ACTIVE", "in": [1]}],
        "lka_on_alt": [{"addr": 298, "signal": "STEER_REQ", "in": [1]}, {"addr": 80, "signal": "STEER_REQ", "in": [1]}],
        "cmd_addrs": [298, 80],  # steering command frames; src >= 128 copies are openpilot echoes
        "cols": {
            "steer_torque": [(298, "TORQUE_REQUEST"), (80, "TORQUE_REQUEST")],
            "driver_torque": [(234, "STEERING_COL_TORQUE")],
            "line_code_l": [(676, "LEFT_LANE_LINE")],
            "line_code_r": [(676, "RIGHT_LANE_LINE")],
        },
        "units": {"steer_torque": "LFA.TORQUE_REQUEST raw", "driver_torque": "MDPS.STEERING_COL_TORQUE raw"},
        "system_name": "LFA (Lane Following Assist)",
        "line_code": {"0": "not detected", "1": "detected · weak", "2": "detected · medium", "3": "detected · strong"},
        "line_code_level": {"0": "none", "1": "bad", "2": "mid", "3": "good"},
        "line_code_note": "0–3 detection level from the camera ECU; it fell from 3 to 1 as the right marking faded in this route. "
                          "The OpenLKA paper labels the same code 1 solid / 2 faded / 3 departure.",
        "extra_cols": {
            "lka_icon": {"src": [(298, "LKA_ICON"), (80, "LKA_ICON")], "kind": "int", "unit": "LFA.LKA_ICON 0 hidden / 1 grey / 2 green / 3 flashing"},
            "lka_fault": {"src": [(234, "LKA_FAULT")], "kind": "int", "unit": "MDPS.LKA_FAULT"},
        },
        "stock_lka_signal": "MDPS 0x0EA LKA_ACTIVE",
        "bus_roles": {"0": "car", "1": "MDPS/ADAS", "2": "camera", "128+": "openpilot tx echo"},
        "verified": True,
    },
    "toyota": {
        "label": "Toyota TSS 2.5+ (RAV4, Camry)",
        "dbc": "final_toyota_canfd.dbc",
        "addresses": {
            881: {"msg": "LTA_RELATED", "signals": ["LTA_STEER_REQUEST", "STEER_ANGLE", "STEERING_PRESSED"]},
            1042: {"msg": "LKAS_HUD", "signals": ["LKAS_STATUS", "LEFT_LINE", "RIGHT_LINE", "LDA_ALERT", "LANE_SWAY_WARNING"]},
            608: {"msg": "STEER_TORQUE_SENSOR", "signals": ["STEER_TORQUE_EPS", "STEER_TORQUE_DRIVER", "STEER_OVERRIDE", "STEER_ANGLE"]},
            740: {"msg": "STEERING_LKA", "signals": ["STEER_TORQUE_CMD", "STEER_REQUEST"]},
            37: {"msg": "STEER_ANGLE_SENSOR", "signals": ["STEER_ANGLE", "STEER_RATE"]},
        },
        "lka_on": [{"addr": 881, "signal": "LTA_STEER_REQUEST", "in": [1]}],
        "lka_on_alt": [{"addr": 1042, "signal": "LKAS_STATUS", "in": [1]}],
        "cmd_addrs": [740],
        "cols": {
            "steer_torque": [(740, "STEER_TORQUE_CMD")],
            "driver_torque": [(608, "STEER_TORQUE_DRIVER")],
            "line_code_l": [(1042, "LEFT_LINE")],
            "line_code_r": [(1042, "RIGHT_LINE")],
        },
        "units": {"steer_torque": "STEERING_LKA.STEER_TORQUE_CMD raw", "driver_torque": "STEER_TORQUE_SENSOR.STEER_TORQUE_DRIVER raw"},
        "system_name": "LTA (Lane Tracing Assist)",
        "line_code": {"0": "none", "1": "solid", "2": "faded", "3": "orange"},
        "line_code_level": {"0": "none", "1": "good", "2": "mid", "3": "bad"},
        "line_code_note": "Toyota LKAS_HUD 0x412 LEFT_LINE/RIGHT_LINE as drawn on the cluster: 0 none, 1 solid white, 2 faded, 3 orange (departure warning).",
        "extra_cols": {
            "lka_status": {"src": [(1042, "LKAS_STATUS")], "kind": "int", "unit": "LKAS_HUD.LKAS_STATUS 0 off / 1 standby / 2 LTA steering (observed with LTA_STEER_REQUEST)"},
            "lda_alert": {"src": [(1042, "LDA_ALERT")], "kind": "int", "unit": "LKAS_HUD.LDA_ALERT 0 none / 1 left / 2 right (lane departure alert)"},
            "steer_torque_eps": {"src": [(608, "STEER_TORQUE_EPS")], "kind": "f", "unit": "STEER_TORQUE_SENSOR.STEER_TORQUE_EPS raw"},
        },
        "stock_lka_signal": "LTA_RELATED 0x371 LTA_STEER_REQUEST",
        "bus_roles": {"0": "car", "1": "radar", "2": "camera (DSU/FCM)", "128+": "openpilot tx echo"},
        "verified": False,
    },
    "volkswagen": {
        "label": "Volkswagen MQB (Tiguan Mk2)",
        "dbc": "vw_mqb_2010.dbc",
        "addresses": {
            159: {"msg": "LH_EPS_03", "signals": ["EPS_HCA_Status", "EPS_Lenkmoment", "EPS_VZ_Lenkmoment", "EPS_Berechneter_LW"]},
            294: {"msg": "HCA_01", "signals": ["HCA_01_Status_HCA", "HCA_01_LM_Offset", "HCA_01_LM_OffSign"]},
            919: {"msg": "LDW_02", "signals": ["LDW_DLC", "LDW_TLC", "LDW_Status_LED_gelb", "LDW_Status_LED_gruen"]},
            134: {"msg": "LWI_01", "signals": ["LWI_Lenkradwinkel", "LWI_VZ_Lenkradwinkel"]},
        },
        "lka_on": [{"addr": 159, "signal": "EPS_HCA_Status", "in": [5]}],
        "lka_on_alt": [{"addr": 294, "signal": "HCA_01_Status_HCA", "in": [5, 7]}],
        "cmd_addrs": [294],
        "cols": {
            "steer_torque": [(294, "HCA_01_LM_Offset")],
            "driver_torque": [(159, "EPS_Lenkmoment")],
        },
        "units": {"steer_torque": "HCA_01.HCA_01_LM_Offset (unsigned, sign in HCA_01_LM_OffSign)", "driver_torque": "LH_EPS_03.EPS_Lenkmoment Nm (unsigned)"},
        "system_name": "Lane Assist (HCA)",
        "line_code": None,
        "extra_cols": {
            "ldw_dlc_m": {"src": [(919, "LDW_DLC")], "kind": "f", "unit": "m · LDW_02.LDW_DLC distance to line crossing (VW's own lane-position estimate)"},
            "ldw_tlc_s": {"src": [(919, "LDW_TLC")], "kind": "f", "unit": "s · LDW_02.LDW_TLC time to line crossing"},
            "hca_status": {"src": [(294, "HCA_01_Status_HCA")], "kind": "int", "unit": "HCA_01.HCA_01_Status_HCA (5/7 = actively steering)"},
            "eps_hca_status": {"src": [(159, "EPS_HCA_Status")], "kind": "int", "unit": "LH_EPS_03.EPS_HCA_Status (5 = HCA active)"},
        },
        "stock_lka_signal": "LH_EPS_03 0x09F EPS_HCA_Status == 5",
        "bus_roles": {"0": "powertrain", "1": "extended", "2": "camera", "128+": "openpilot tx echo"},
        "verified": False,
    },
    "mache": {
        "label": "Ford CAN-FD (Mustang Mach-E)",
        "dbc": "ford_canfd.dbc",
        "addresses": {
            982: {"msg": "LateralMotionControl2", "signals": ["LatCtl_D2_Rq", "LatCtlPathOffst_L_Actl", "LatCtlCurv_No_Actl", "LatCtlPath_An_Actl"]},
            972: {"msg": "Lane_Assist_Data3_FD1", "signals": ["LaHandsOff_B_Actl", "LaActAvail_D_Actl", "LaActDeny_B_Actl", "LatCtlSte_D_Stat"]},
            970: {"msg": "Lane_Assist_Data1", "signals": ["LkaActvStats_D2_Req"]},
        },
        "lka_on": [{"addr": 982, "signal": "LatCtl_D2_Rq", "in": [1]}],
        "lka_on_alt": [{"addr": 970, "signal": "LkaActvStats_D2_Req", "in": [1, 2, 3]}],
        "cmd_addrs": [982],
        "cols": {
            "steer_torque": [(982, "LatCtlCurv_No_Actl")],
        },
        "units": {"steer_torque": "LateralMotionControl2.LatCtlCurv_No_Actl 1/m (curvature command, Ford has no torque request)"},
        "system_name": "Lane Centering (LatCtl)",
        "line_code": None,
        "extra_cols": {
            "ford_path_offset_m": {"src": [(982, "LatCtlPathOffst_L_Actl")], "kind": "f", "unit": "m · LateralMotionControl2.LatCtlPathOffst_L_Actl (Ford's own lane offset)"},
            "ford_path_angle": {"src": [(982, "LatCtlPath_An_Actl")], "kind": "f", "unit": "rad · LateralMotionControl2.LatCtlPath_An_Actl"},
            "ford_hands_off": {"src": [(972, "LaHandsOff_B_Actl")], "kind": "int", "unit": "Lane_Assist_Data3_FD1.LaHandsOff_B_Actl"},
            "ford_lka_stats": {"src": [(970, "LkaActvStats_D2_Req")], "kind": "int", "unit": "Lane_Assist_Data1.LkaActvStats_D2_Req (lane-departure aid state)"},
        },
        "stock_lka_signal": "LateralMotionControl2 0x3D6 LatCtl_D2_Rq",
        "bus_roles": {"0": "powertrain", "1": "chassis", "2": "camera", "128+": "openpilot tx echo"},
        "verified": False,
    },
    "accord": {
        "label": "Honda Accord Hybrid (2018)",
        "dbc": "final_cleaned_extended_honda_accord_acc_lka.dbc",
        # the lab's trimmed Accord DBC has no STEERING_CONTROL (0xE4) / STEERING_SENSORS (0x14A): command torque stays null
        "addresses": {
            399: {"msg": "STEER_STATUS", "signals": ["STEER_CONTROL_ACTIVE", "STEER_TORQUE_SENSOR", "STEER_STATUS"]},
            576: {"msg": "LEFT_LANE_LINE_1", "signals": ["LINE_OFFSET", "LINE_PROBABILITY", "LINE_ANGLE", "LINE_DISTANCE_VISIBLE"]},
            579: {"msg": "RIGHT_LANE_LINE_1", "signals": ["LINE_OFFSET", "LINE_PROBABILITY", "LINE_ANGLE", "LINE_DISTANCE_VISIBLE"]},
            829: {"msg": "LKAS_HUD", "signals": []},
        },
        "lka_on": [{"addr": 399, "signal": "STEER_CONTROL_ACTIVE", "in": [1]}],
        "lka_on_alt": None,
        "cmd_addrs": [228],
        "cols": {
            "steer_torque": [],
            "driver_torque": [(399, "STEER_TORQUE_SENSOR")],
        },
        "units": {"steer_torque": None, "driver_torque": "STEER_STATUS.STEER_TORQUE_SENSOR raw"},
        "system_name": "LKAS (Lane Keeping Assist)",
        "line_code": None,
        "extra_cols": {
            "honda_line_prob_l": {"src": [(576, "LINE_PROBABILITY")], "kind": "f", "tol": 0.06, "unit": "LEFT_LANE_LINE_1.LINE_PROBABILITY (Honda camera)"},
            "honda_line_offset_l": {"src": [(576, "LINE_OFFSET")], "kind": "f", "tol": 0.06, "unit": "LEFT_LANE_LINE_1.LINE_OFFSET"},
            "honda_line_prob_r": {"src": [(579, "LINE_PROBABILITY")], "kind": "f", "tol": 0.06, "unit": "RIGHT_LANE_LINE_1.LINE_PROBABILITY"},
            "honda_line_offset_r": {"src": [(579, "LINE_OFFSET")], "kind": "f", "tol": 0.06, "unit": "RIGHT_LANE_LINE_1.LINE_OFFSET"},
        },
        "stock_lka_signal": "STEER_STATUS 0x18F STEER_CONTROL_ACTIVE",
        "bus_roles": {"0": "powertrain", "1": "radar", "2": "camera", "128+": "openpilot tx echo"},
        "verified": False,
    },
    "tesla_model3": {
        "label": "Tesla Model 3 (AP3)",
        "dbc": "tesla-model-3.dbc",
        # tesla-model-3.dbc (the lab decoder's DBC) has no 0x488 DAS_steeringControl / 0x370 EPAS3S_sysStatus,
        # so the stock state comes from DAS_status.DAS_autopilotState (3 ACTIVE_NOMINAL / 4 ACTIVE_RESTRICTED / 5 ACTIVE_NAV)
        "addresses": {
            921: {"msg": "ID399DAS_status", "signals": ["DAS_autopilotState", "DAS_autopilotHandsOnState", "DAS_lssState", "DAS_laneDepartureWarning"]},
            697: {"msg": "ID2B9DAS_control", "signals": ["DAS_accState", "DAS_accelMax", "DAS_accelMin", "DAS_setSpeed"]},
            264: {"msg": "ID108DIR_torque", "signals": ["DIR_torqueActual", "DIR_torqueCommand"]},
        },
        "lka_on": [{"addr": 921, "signal": "DAS_autopilotState", "in": [3, 4, 5]}],
        "lka_on_alt": None,
        "cmd_addrs": [1160],
        "cols": {
            "steer_torque": [],
            "driver_torque": [],
        },
        "units": {"steer_torque": None, "driver_torque": "carState.steeringTorque raw"},
        "system_name": "Autopilot (Autosteer)",
        "line_code": None,
        "extra_cols": {
            "tesla_ap_state": {"src": [(921, "DAS_autopilotState")], "kind": "int", "unit": "DAS_status.DAS_autopilotState 0 DISABLED / 1 UNAVAILABLE / 2 AVAILABLE / 3 ACTIVE_NOMINAL / 4 ACTIVE_RESTRICTED / 5 ACTIVE_NAV / 6 ABORTING / 7 ABORTED / 8 FAULT"},
            "tesla_hands_on": {"src": [(921, "DAS_autopilotHandsOnState")], "kind": "int", "unit": "DAS_status.DAS_autopilotHandsOnState"},
            "tesla_acc_state": {"src": [(697, "DAS_accState")], "kind": "int", "unit": "DAS_control.DAS_accState"},
        },
        "stock_lka_signal": "DAS_status 0x399 DAS_autopilotState in {ACTIVE_NOMINAL, ACTIVE_RESTRICTED, ACTIVE_NAV}",
        "bus_roles": {"0": "vehicle", "1": "party", "2": "autopilot", "128+": "openpilot tx echo"},
        "verified": False,
    },
}
STOCK_SPEC["kia_ev6"] = dict(STOCK_SPEC["ioniq"], label="Kia EV6 (CAN-FD; no 0x2A4 lane codes on this car)")
STOCK_SPEC["niro"] = dict(STOCK_SPEC["ioniq"], label="Kia Niro 2023 (CAN-FD)")

CODES = {
    "blinker": {"0": "off", "1": "left", "2": "right"},
    "lane_change_state": {"0": "off", "1": "preLaneChange", "2": "laneChangeStarting", "3": "laneChangeFinishing"},
}
SIGN = {
    "steer_angle_deg": "+left",
    "curvature_1pm": "+left",
    "lane_dev_m": "+ = car left of lane centre (modelV2 +y right)",
}
SIGNAL_COLS = ["t", "v_ego_mps", "steer_angle_deg", "steer_torque", "driver_torque", "lka_on", "op_on", "op_tx", "acc_on",
               "line_code_l", "line_code_r", "op_prob_l", "op_prob_r", "lane_dev_m", "lane_width_m", "curvature_1pm",
               "brake", "gas", "steering_pressed", "blinker", "lane_change_state"]
INT_COLS = {"lka_on", "op_on", "op_tx", "acc_on", "line_code_l", "line_code_r", "brake", "gas", "steering_pressed", "blinker", "lane_change_state"}
PROB_COLS = {"op_prob_l", "op_prob_r"}


# ----------------------------------------------------------------------------- openpilot / lab imports
_LR = None


def init_logreader():
    """Import openpilot's LogReader (with the streaming-zstd patch used by overview/scan_qlogs.py)."""
    global _LR
    if _LR is not None:
        return _LR
    if OP_DIR not in sys.path:
        sys.path.insert(0, OP_DIR)
    import io
    import zstandard as zstd
    import tools.lib.logreader as lrmod

    def _dec(dat):
        with zstd.ZstdDecompressor().stream_reader(io.BytesIO(dat)) as r:
            return r.read()

    lrmod.zstd.decompress = _dec
    from tools.lib.logreader import LogReader
    _LR = LogReader
    return _LR


def read_log(path: str) -> list:
    """Whole segment as a list (the lab reader iterates twice; LogReader is single-pass)."""
    LogReader = init_logreader()
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return list(LogReader(path, only_union_types=True))


_LAB = None


def lab_modules():
    """Import the lab's ReadRlogOpAttr / ReadRlogOpAttr_new / CAN_decoder_functions unmodified."""
    global _LAB
    if _LAB is None:
        init_logreader()
        if LAB_DIR not in sys.path:
            sys.path.insert(0, LAB_DIR)
        import CAN_decoder_functions as cdf
        import ReadRlogOpAttr as rr
        try:
            import ReadRlogOpAttr_new as rr_new
        except Exception:  # pragma: no cover
            rr_new = None
        _LAB = (cdf, rr, rr_new)
    return _LAB


def decoder_for(car_dir: str):
    """Return (decoder_fn, fresh_ext_dict, make_key, fn_name, dict_name, dbc_path).

    The lab's module-level *_can_msg_dict objects are mutated by read_route_log_into_df
    (logs_dict.update aliases them), so a FRESH dict is built for every call.
    """
    mk = make_key_for(car_dir)
    if mk is None or mk not in DECODERS:
        raise KeyError(f"no lab decoder for car_dir {car_dir!r}")
    cdf, _, _ = lab_modules()
    fn_name, dict_name, dbc = DECODERS[mk]
    fn = getattr(cdf, fn_name)
    template = getattr(cdf, dict_name)
    fresh = {k: {} for k in template if k != ""}  # MACHE_msg_dict has an empty "" key
    return fn, fresh, mk, fn_name, dict_name, os.path.join(DBC_DIR, dbc)


def lab_decode(msgs: list, car_dir: str):
    """Run the lab's read_route_log_into_df on a message list; returns (df, info).

    Falls back to ReadRlogOpAttr_new.read_route_log_into_df_new when deviceState.startedMonoTime is absent.
    """
    cdf, rr, rr_new = lab_modules()
    fn, ext, mk, fn_name, dict_name, dbc = decoder_for(car_dir)
    info = {"decoder": fn_name, "ext_dict": dict_name, "dbc": os.path.basename(dbc), "reader": "ReadRlogOpAttr.read_route_log_into_df"}
    if started_mono(msgs) is None:
        if rr_new is None:
            raise RuntimeError("startedMonoTime missing and ReadRlogOpAttr_new unavailable")
        info["reader"] = "ReadRlogOpAttr_new.read_route_log_into_df_new"
        df, prefix, car_name, dongle, stamp = rr_new.read_route_log_into_df_new(msgs, realign_index_name="vEgo", can_msg_extension=ext, can_decoder_fn=fn)
    else:
        df, prefix, car_name, dongle, stamp = rr.read_route_log_into_df(msgs, realign_index_name="vEgo", can_msg_extension=ext, can_decoder_fn=fn)
    info.update({"file_prefix": prefix, "car_name": car_name, "dongle": dongle, "drive_min_time_stamp": stamp, "n_rows": int(len(df)), "n_cols": int(df.shape[1])})
    return df, info


# ----------------------------------------------------------------------------- message helpers
def started_mono(msgs) -> int | None:
    for m in msgs:
        if m.which() == "deviceState" and m.deviceState.startedMonoTime != -1:
            return int(m.deviceState.startedMonoTime)
    return None


def rel_t(m, started: int) -> float:
    return (m.logMonoTime - started) / 1e9


def video_anchor(msgs, seg: int, started: int | None = None) -> dict | None:
    """Video anchor from qRoadEncodeIdx: route-seconds of the first qcamera frame of this segment."""
    started = started if started is not None else started_mono(msgs)
    first = last = None
    n = 0
    for m in msgs:
        if m.which() != "qRoadEncodeIdx":
            continue
        q = m.qRoadEncodeIdx
        if q.segmentNum != seg:
            continue
        n += 1
        if first is None:
            first = q
        last = q
    if first is None or started is None:
        return None
    return {
        "seg": seg,
        "t_video0": (first.timestampSof - started) / 1e9,
        "sof_ns": int(first.timestampSof),
        "eof_ns": int(first.timestampEof),
        "t_video_end": (last.timestampSof - started) / 1e9,
        "n_frames": n,
        "first_frame_id": int(first.frameId),
        "first_segment_id": int(first.segmentId),
    }


def stock_bus_table(msgs, addrs=None):
    """Most frequent src<128 per address (+ echo counts for src>=128).

    Returns (bus_of: {addr: src}, table: {addr: {src: n}}, echoes: {addr: n}).
    """
    table = collections.defaultdict(collections.Counter)
    for m in msgs:
        if m.which() != "can":
            continue
        for f in m.can:
            if addrs is None or f.address in addrs:
                table[f.address][f.src] += 1
    bus_of, echoes = {}, {}
    for a, c in table.items():
        stock = [(n, s) for s, n in c.items() if s < 128]
        if stock:
            bus_of[a] = max(stock)[1]
        ne = sum(n for s, n in c.items() if s >= 128)
        if ne:
            echoes[a] = ne
    return bus_of, {a: dict(c) for a, c in table.items()}, echoes


def echo_mask(msgs, cmd_addrs, started: int):
    """Route-seconds of every openpilot tx echo (src >= 128) of a steering-command address.

    openpilot's own transmitted CAN frames are logged back with src >= 128; stock systems never
    produce them, so their presence == "openpilot was steering".
    """
    ts = []
    for m in msgs:
        if m.which() != "can":
            continue
        for f in m.can:
            if f.src >= 128 and f.address in cmd_addrs:
                ts.append(rel_t(m, started))
                break
    return ts


def wall_clock(msgs, started: int):
    """(route_seconds, unix_ns) of the first clocks message; wall = unix_ns + (t - t0)*1e9."""
    for m in msgs:
        if m.which() == "clocks":
            return rel_t(m, started), int(m.clocks.wallTimeNanos)
    return None


def eastern_str(unix_ns: float, fmt="%Y-%m-%d %H:%M:%S") -> str:
    return _dt.datetime.fromtimestamp(unix_ns / 1e9, tz=_dt.timezone.utc).astimezone(EASTERN).strftime(fmt)


def gps_clock(msgs, started: int):
    """(route_seconds, unix_ns) from the first gpsLocation fix with a valid unixTimestampMillis.

    Preferred over clocks.wallTimeNanos: several 530075 routes start on the device's default clock
    (2023-11-21 16:10:5x) until time sync, so the wall clock there is bogus.
    """
    for m in msgs:
        if m.which() == "gpsLocation":
            g = m.gpsLocation
            if (g.hasFix or (g.latitude != 0.0 and g.longitude != 0.0)) and g.unixTimestampMillis > 1.5e12:
                return rel_t(m, started), int(g.unixTimestampMillis) * 1_000_000
    return None


def spec_decode(msgs, make_key: str, started: int, bus_of: dict, addrs=None):
    """Second-pass cantools decode of STOCK_SPEC addresses on the stock bus.

    Returns {addr: pandas.DataFrame(index=route_seconds, columns=signals)}.
    """
    import cantools
    import pandas as pd

    spec = STOCK_SPEC[make_key]
    db = load_dbc(spec["dbc"])
    want = {a: s for a, s in spec["addresses"].items() if (addrs is None or a in addrs)}
    rows = {a: [] for a in want}
    names = {}
    for a in want:
        try:
            names[a] = [s.name for s in db.get_message_by_frame_id(a).signals]
        except KeyError:
            names[a] = None
    for m in msgs:
        if m.which() != "can":
            continue
        t = rel_t(m, started)
        for f in m.can:
            a = f.address
            if a not in want or names[a] is None or f.src != bus_of.get(a, -1):
                continue
            try:
                d = db.decode_message(a, bytes(f.dat), decode_choices=False, allow_truncated=True)
            except Exception:
                continue
            d["_t"] = t
            rows[a].append(d)
    out = {}
    for a, lst in rows.items():
        if not lst:
            continue
        df = pd.DataFrame(lst).set_index("_t")
        df = df[~df.index.duplicated(keep="last")].sort_index()
        out[a] = df
    return out


def eval_rules(rules, decoded: dict):
    """OR of rules over per-address decoded frames -> pandas Series(0/1) on the union index; None if no data."""
    import pandas as pd

    series = []
    for r in rules or []:
        df = decoded.get(r["addr"])
        if df is None or r["signal"] not in df.columns:
            continue
        series.append(df[r["signal"]].isin(r["in"]).astype(int))
    if not series:
        return None
    if len(series) == 1:
        return series[0]
    idx = series[0].index
    for s in series[1:]:
        idx = idx.union(s.index)
    acc = None
    for s in series:
        s2 = s.reindex(idx, method="nearest", tolerance=0.1).fillna(0).astype(int)
        acc = s2 if acc is None else (acc | s2)
    return acc


def first_col(decoded: dict, candidates):
    """First (addr, signal) that exists in the decoded dict -> (Series, 'MSG.SIGNAL') or (None, None)."""
    for a, sig in candidates or []:
        df = decoded.get(a)
        if df is not None and sig in df.columns:
            return df[sig], (a, sig)
    return None, None


# ----------------------------------------------------------------------------- files / routes
def seg_files(route_dir: str, seg: int) -> dict:
    """Paths of rlog / qlog / qcamera for a segment (None when missing). Handles .zst/.bz2 rlogs."""
    out = {"rlog": None, "qlog": None, "qcamera": None}
    for ext in ("", ".zst", ".bz2"):
        p = os.path.join(route_dir, f"{seg}--rlog{ext}")
        if os.path.exists(p):
            out["rlog"] = p
            break
    for ext in ("", ".zst", ".bz2"):
        p = os.path.join(route_dir, f"{seg}--qlog{ext}")
        if os.path.exists(p):
            out["qlog"] = p
            break
    p = os.path.join(route_dir, f"{seg}--qcamera.ts")
    if os.path.exists(p):
        out["qcamera"] = p
    return out


def route_segments(route_dir: str) -> list[int]:
    segs = set()
    for f in os.listdir(route_dir):
        m = SEG_RE.match(f)
        if m:
            segs.add(int(m.group(1)))
    return sorted(segs)


def route_list(car_dirs=None, dongles=None):
    """All (car_dir, dongle, route, rel_path) under RAW_DIR whose route id passes ROUTE_RE."""
    out = []
    for car in sorted(os.listdir(RAW_DIR)):
        if car_dirs and car not in car_dirs:
            continue
        cdir = os.path.join(RAW_DIR, car)
        if not os.path.isdir(cdir):
            continue
        for dongle in sorted(os.listdir(cdir)):
            if dongles and dongle not in dongles:
                continue
            ddir = os.path.join(cdir, dongle)
            if not os.path.isdir(ddir):
                continue
            for route in sorted(os.listdir(ddir)):
                if ROUTE_RE.match(route) and os.path.isdir(os.path.join(ddir, route)):
                    out.append((car, dongle, route, f"{car}/{dongle}/{route}"))
    return out


def route_master_rows(filter_fn=None):
    with open(ROUTE_MASTER, newline="") as f:
        rows = [r for r in csv.DictReader(f) if ROUTE_RE.match(r.get("route", ""))]
    return [r for r in rows if filter_fn is None or filter_fn(r)]


# ----------------------------------------------------------------------------- provenance / io
def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def decoder_commit() -> str | None:
    """Short commit of the lab decoder dir if it is a git repo, else None."""
    try:
        r = subprocess.run(["git", "-C", LAB_DIR, "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else None
    except Exception:
        return None


def dbc_info(dbc_file: str) -> dict:
    p = os.path.join(DBC_DIR, dbc_file)
    return {"file": dbc_file, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}


_DBC_CACHE = {}


def load_dbc(dbc_file: str):
    import cantools

    if dbc_file not in _DBC_CACHE:
        _DBC_CACHE[dbc_file] = cantools.database.load_file(os.path.join(DBC_DIR, dbc_file))
    return _DBC_CACHE[dbc_file]


def check_spec(make_keys=None) -> list[str]:
    """Report STOCK_SPEC (addr, signal) pairs missing from their DBC. Empty list == all good."""
    problems = []
    for mk, spec in STOCK_SPEC.items():
        if make_keys and mk not in make_keys:
            continue
        db = load_dbc(spec["dbc"])
        for a, d in spec["addresses"].items():
            try:
                msg = db.get_message_by_frame_id(a)
            except KeyError:
                problems.append(f"{mk}: 0x{a:X} ({d['msg']}) not in {spec['dbc']}")
                continue
            have = {s.name for s in msg.signals}
            if msg.name != d["msg"]:
                problems.append(f"{mk}: 0x{a:X} is {msg.name} in DBC, spec says {d['msg']}")
            for s in d["signals"]:
                if s not in have:
                    problems.append(f"{mk}: 0x{a:X}.{s} missing (have {sorted(have)[:12]}...)")
    return problems


def ffprobe(path: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=start_time,duration,size:stream=nb_frames,r_frame_rate,width,height,codec_name",
                        "-of", "json", path], capture_output=True, text=True)
    j = json.loads(r.stdout or "{}")
    fmt = j.get("format", {})
    st = (j.get("streams") or [{}])[0]
    return {
        "start_time": float(fmt.get("start_time", "nan")),
        "duration": float(fmt.get("duration", "nan")),
        "size": int(fmt.get("size", 0) or 0),
        "nb_frames": int(st["nb_frames"]) if str(st.get("nb_frames", "")).isdigit() else None,
        "fps": st.get("r_frame_rate"),
        "width": st.get("width"),
        "height": st.get("height"),
        "codec": st.get("codec_name"),
    }


def is_missing(x) -> bool:
    if x is None:
        return True
    try:
        return isinstance(x, float) and math.isnan(x)
    except Exception:
        return False


def num(x, nd=3):
    """float rounded to nd dp, or None (never NaN)."""
    if is_missing(x):
        return None
    try:
        v = float(x)
    except Exception:
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return round(v, nd)


def integer(x):
    if is_missing(x):
        return None
    try:
        return int(round(float(x)))
    except Exception:
        return None


def write_json(path: str, obj, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), allow_nan=False)
        else:
            json.dump(obj, f, indent=1, allow_nan=False)
    return os.path.getsize(path)


def entry_hash(entry: dict) -> str:
    s = json.dumps(entry, sort_keys=True, default=str) + "|" + PIPELINE_VERSION
    return hashlib.sha1(s.encode()).hexdigest()[:12]


def nice():
    try:
        os.nice(10)
    except Exception:
        pass
