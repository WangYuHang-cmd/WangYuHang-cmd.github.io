#!/usr/bin/env python3
"""Stage D - export one showcase clip from clips.yaml -> <out>/<id>/{clip.mp4,poster.jpg,signals.json,track.json,frames.json,meta.json}

Pipeline per clip (see README.md and the unified JSON schema in the plan):
  1. find the rlog/qcamera segments touched by [t_a, t_b] (route seconds; abort cleanly on gaps)
  2. lab decoder (ReadRlogOpAttr.read_route_log_into_df + CAN_decoder_functions.<make>) on every touched segment
  3. second pass over the same messages: stock-spec cantools decode on the stock bus (src<128), openpilot
     echoes (src>=128 -> op_tx), modelV2 lane geometry, controlsState, blinkers, GPS, clocks, qRoadEncodeIdx
  4. resample onto t_a + k/hz (nearest, per-source tolerance), derived metrics, events, stats
  5. ffmpeg concat + trim + re-encode (libx264 crf 27, g 40, faststart, no audio), poster at the key moment,
     alignment checks against ffprobe
  6. frames.json (raw CAN frames around the key moment, decoded), track.json (1 Hz GPS), meta.json (provenance)
Idempotent: a clip is rebuilt only when its clips.yaml entry hash changes (or --force).

Usage: export_clip.py --spec clips.yaml --id ioniq5-i275-stock-lfa [--hz 10] [--out /data/datasets/temporary/web_showcase/site/can] [--force]
       export_clip.py --spec clips.yaml --all
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
import math
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

FRAME_DT = 1.0 / C.VIDEO_FPS

# lab-decoder column that mirrors the stock lateral-active state, for the cross-check in meta
LAB_XCHECK = {"ioniq": "lka_active", "kia_ev6": "lka_active", "niro": "lka_active", "toyota": "steer_request",
              "mache": "lka", "accord": "lka", "tesla_model3": None, "volkswagen": None}


class ClipError(RuntimeError):
    pass


# ----------------------------------------------------------------------------- spec
def load_clips(path):
    import yaml

    with open(path) as f:
        spec = yaml.safe_load(f)
    defaults = spec.get("defaults", {}) or {}
    clips = []
    for e in spec.get("clips", []):
        d = dict(defaults)
        d.update(e)
        clips.append(d)
    return clips


# ----------------------------------------------------------------------------- segments
def touched_segments(rdir, t_a, t_b, log):
    """Read candidate segments and keep those whose video or CAN range intersects the window."""
    lo, hi = max(0, int(t_a // 60) - 1), int(t_b // 60) + 1
    avail = set(C.route_segments(rdir))
    out, gaps = [], []
    for seg in range(lo, hi + 1):
        if seg not in avail:
            continue
        files = C.seg_files(rdir, seg)
        if files["rlog"] is None:
            gaps.append((seg, "rlog"))
            continue
        t0 = time.time()
        msgs = C.read_log(files["rlog"])
        started = C.started_mono(msgs)
        if started is None:
            gaps.append((seg, "startedMonoTime"))
            log(f"  seg {seg}: no deviceState.startedMonoTime (fallback reader will be used)")
            started = next(m.logMonoTime for m in msgs if m.which() == "carState")
        ts = [C.rel_t(m, started) for m in msgs if m.which() == "carState"]
        va = C.video_anchor(msgs, seg, started)
        can_range = (ts[0], ts[-1]) if ts else None
        vid_range = (va["t_video0"], va["t_video0"] + va["n_frames"] * FRAME_DT) if va else None
        keep_vid = vid_range and vid_range[0] < t_b and vid_range[1] > t_a
        keep_can = can_range and can_range[0] < t_b + 0.5 and can_range[1] > t_a - 0.5
        log(f"  seg {seg}: read {len(msgs)} msgs in {time.time() - t0:.1f}s  can {can_range and tuple(round(x, 2) for x in can_range)}  video {vid_range and tuple(round(x, 2) for x in vid_range)}  -> {'KEEP' if keep_vid or keep_can else 'skip'}")
        if keep_vid or keep_can:
            out.append({"seg": seg, "files": files, "msgs": msgs, "started": started, "va": va, "can_range": can_range, "vid_range": vid_range,
                        "video_needed": bool(keep_vid)})
        else:
            del msgs
    return out, gaps


# ----------------------------------------------------------------------------- resampling
def resample(series, grid, tol=None):
    """pandas Series (float index, route seconds) -> numpy array on grid (NaN where no sample within tol).

    tol=None -> adaptive: 0.6 x the median message period, clamped to [0.02, 0.6] s, so 100 Hz signals need a
    sample within 20 ms while 1 Hz messages (Toyota LKAS_HUD) or 20 Hz ones (Ford LateralMotionControl2) still fill
    the grid instead of reading as missing.
    """
    import numpy as np
    import pandas as pd

    if series is None or len(series) == 0:
        return np.full(len(grid), np.nan)
    s = pd.Series(series.values, index=pd.Index(series.index, dtype="float64"))
    s = s[~s.index.isna()]
    s = s[~s.index.duplicated(keep="last")].sort_index()
    s = pd.to_numeric(s, errors="coerce")
    if tol is None:
        dt = float(np.median(np.diff(s.index.to_numpy()))) if len(s) > 2 else 0.1
        tol = min(max(0.6 * dt, 0.02), 0.6)
    return s.reindex(pd.Index(grid), method="nearest", tolerance=tol).to_numpy(dtype="float64")


def series_from(pairs):
    import pandas as pd

    if not pairs:
        return None
    t, v = zip(*pairs)
    return pd.Series(v, index=list(t), dtype="float64")


def col_out(arr, kind):
    if kind == "int":
        return [C.integer(x) for x in arr]
    if kind == "prob":
        return [C.num(x, 2) for x in arr]
    return [C.num(x, 3) for x in arr]


# ----------------------------------------------------------------------------- events
def detect_events(cols, hz, dur, sig="stock lateral signal"):
    """Auto events; `sig` is the make's stock lateral-active signal name (STOCK_SPEC stock_lka_signal) used in labels."""
    import numpy as np

    ev = []
    t = cols["t"]
    n = len(t)

    def arr(name):
        return np.array([np.nan if v is None else v for v in cols[name]], dtype="float64")

    lka, pressed, v = arr("lka_on"), arr("steering_pressed"), arr("v_ego_mps")
    # debounce: a new lateral state must persist >= 0.3 s (VW EPS_HCA_Status flickers 5<->3 for tens of ms)
    hold = max(1, int(round(0.3 * hz)))
    lka_db = lka.copy()
    for k in range(1, n):
        if np.isnan(lka[k]) or np.isnan(lka_db[k - 1]):
            continue
        if lka[k] != lka_db[k - 1]:
            run_ok = all((not np.isnan(lka[j])) and lka[j] == lka[k] for j in range(k, min(n, k + hold)))
            lka_db[k] = lka[k] if run_ok else lka_db[k - 1]
    lka = lka_db
    for k in range(1, n):
        if not (np.isnan(lka[k]) or np.isnan(lka[k - 1])) and lka[k] != lka[k - 1]:
            if lka[k] == 1:
                ev.append({"t": t[k], "kind": "lka_on", "label": f"Stock lane keeping active ({sig} → active)"})
            else:
                w = slice(max(0, k - int(0.5 * hz)), min(n, k + int(0.5 * hz) + 1))
                if np.nanmax(pressed[w]) == 1 if not np.all(np.isnan(pressed[w])) else False:
                    ev.append({"t": t[k], "kind": "takeover", "label": f"Driver takes over: steering pressed, {sig} → inactive"})
                else:
                    ev.append({"t": t[k], "kind": "lka_off", "label": f"Stock lane keeping disengages ({sig} → inactive)"})
    pl, pr = arr("op_prob_l"), arr("op_prob_r")
    pm = np.fmin(pl, pr)
    lost = pm < 0.3
    k = 0
    min_len = max(1, int(0.5 * hz))
    while k < n:
        if lost[k]:
            j = k
            while j < n and lost[j]:
                j += 1
            if j - k >= min_len:
                side = "left" if (np.nanmean(pl[k:j]) < np.nanmean(pr[k:j])) else "right"
                ev.append({"t": t[k], "kind": "line_lost", "label": f"Lane-model confidence drops below 0.3 ({side} line) for {(j - k) / hz:.1f} s"})
                if j < n:
                    ev.append({"t": t[j], "kind": "line_back", "label": "Lane lines recovered (confidence ≥ 0.3)"})
            k = j
        else:
            k += 1
    dev = arr("lane_dev_m")
    if not np.all(np.isnan(dev)):
        k = int(np.nanargmax(np.abs(dev)))
        if abs(dev[k]) >= 0.4:
            ev.append({"t": t[k], "kind": "dev_peak", "label": f"Largest offset from lane centre: {dev[k]:+.2f} m ({'left' if dev[k] > 0 else 'right'})"})
    brake = arr("brake")
    for k in range(1, n):
        if brake[k] == 1 and brake[k - 1] == 0 and v[k] > 15:
            ev.append({"t": t[k], "kind": "brake", "label": f"Brake pressed at {v[k]:.0f} m/s"})
    lcs = arr("lane_change_state")
    lc_times = []
    for k in range(1, n):
        if lcs[k] == 2 and lcs[k - 1] != 2:
            ev.append({"t": t[k], "kind": "lane_change", "label": "openpilot lane-change model: laneChangeStarting"})
            lc_times.append(t[k])
    # turn signal at speed without a model lane-change state (e.g. openpilot not engaged) -> lane_change too
    blk = arr("blinker")
    for k in range(1, n):
        if blk[k] in (1, 2) and blk[k - 1] == 0 and v[k] > 15 and not any(abs(t[k] - x) < 4.0 for x in lc_times):
            side = "left" if blk[k] == 1 else "right"
            ev.append({"t": t[k], "kind": "lane_change", "label": f"Turn signal {side} at {v[k]:.0f} m/s"})
            lc_times.append(t[k])
    ev = [e for e in ev if 0 <= e["t"] <= dur]
    ev.sort(key=lambda e: e["t"])
    # thin out near-duplicates (< 1 s apart, same kind)
    out = []
    for e in ev:
        if out and e["kind"] == out[-1]["kind"] and e["t"] - out[-1]["t"] < 1.0:
            continue
        out.append(e)
    return out[:10]


PRIORITY = ["takeover", "lka_off", "lane_change", "line_lost", "dev_peak", "brake", "lka_on", "custom", "line_back"]


def pick_key_moment(events, dur):
    for kind in PRIORITY:
        for e in events:
            if e["kind"] == kind:
                return {"t": e["t"], "label": e["kind"]}
    return {"t": round(dur / 2, 2), "label": "mid"}


# ----------------------------------------------------------------------------- video
def run(cmd, log):
    log("  $ " + " ".join(str(c) for c in cmd))
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True)
    if r.returncode != 0:
        raise ClipError(f"command failed ({r.returncode}): {r.stderr[-2000:]}")
    return r


def source_frame_times(path, start_rel, span=0.4, preroll=4.0):
    """Relative (pts_time - start_time) timestamps of the source frames within +/-span of start_rel, as ffmpeg's
    filters see them. ffprobe's -read_intervals seeks to the NEXT keyframe, so decoding starts >= preroll s (more
    than one GOP) before the point of interest and the list is filtered afterwards - otherwise frames between the
    interval start and the next keyframe look "missing"."""
    st = C.ffprobe(path)["start_time"]
    lo = max(0.0, start_rel - max(span, preroll))
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=pts_time", "-of", "csv=p=0",
                        "-read_intervals", f"{st + lo:.4f}%{st + start_rel + span:.4f}", path], capture_output=True, text=True)
    out = []
    for line in r.stdout.splitlines():
        try:
            t = float(line.split(",")[0]) - st
        except ValueError:
            continue
        if start_rel - span - 1e-6 <= t <= start_rel + span + 1e-6:
            out.append(t)
    return sorted(out)


def encode_video(vsegs, ss, dur, k0, work, out_mp4, log, crf=27):
    """Concat the touched qcamera.ts files, cut [ss, ss+dur) and re-encode.

    Source frame k sits at (k - ~0.002) * 50 ms relative to the stream start (PTS jitter of ~0.1 ms below the
    grid), so the cut is placed at HALF-frame boundaries: frame k0 is the first frame with pts >= ss - 25 ms.
    """
    lst = os.path.join(work, "concat.txt")
    with open(lst, "w") as f:
        for s in vsegs:
            f.write(f"file '{s['files']['qcamera']}'\n")
    t_start, t_end = ss - FRAME_DT / 2, ss + dur - FRAME_DT / 2
    # verify on the first source file that the first frame at/after t_start is frame k0
    rel = source_frame_times(vsegs[0]["files"]["qcamera"], ss)
    cand = [t for t in rel if t >= t_start]
    if not cand:
        raise ClipError(f"no source frame at/after {t_start:.4f} s in {vsegs[0]['files']['qcamera']}")
    k_first = int(round(cand[0] / FRAME_DT))
    if k_first != k0:
        raise ClipError(f"first cut frame would be {k_first}, expected {k0} (pts {cand[0]:.4f} vs ss {ss:.4f})")
    cut_check = {"first_frame_pts_rel": round(cand[0], 4), "first_frame_index": k_first, "trim_start": round(t_start, 4), "trim_end": round(t_end, 4)}
    attempts = []
    for attempt in range(3):
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
               "-vf", f"trim=start={t_start:.4f}:end={t_end:.4f},setpts=PTS-STARTPTS", "-fps_mode", "passthrough",
               "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p", "-g", "40",
               "-movflags", "+faststart", "-an", out_mp4]
        run(cmd, log)
        size = os.path.getsize(out_mp4)
        attempts.append({"crf": crf, "bytes": size})
        log(f"  encoded crf {crf}: {size / 1e6:.2f} MB")
        if size <= C.CAPS["video"]:
            break
        crf += 2
    return crf, attempts, cut_check


# ----------------------------------------------------------------------------- main export
def export(entry, out_root, hz, force, log=None):
    import numpy as np
    import pandas as pd

    cid = entry["id"]
    if log is None:
        def log(s, _cid=cid):
            print(f"[{_cid}] {s}" if not s.startswith("[") else s, flush=True)
    car_dir, dongle, route = entry["car_dir"], entry["dongle"], entry["route"]
    rel_path = f"{car_dir}/{dongle}/{route}"
    rdir = os.path.join(C.RAW_DIR, rel_path)
    if not os.path.isdir(rdir):
        raise ClipError(f"route dir missing: {rdir}")
    mk = C.make_key_for(car_dir)
    if mk is None:
        raise ClipError(f"no decoder for {car_dir}")
    spec = C.STOCK_SPEC[mk]
    out_dir = os.path.join(out_root, cid)
    work = os.path.join(C.CLIPS_DIR, cid)
    os.makedirs(work, exist_ok=True)
    ehash = C.entry_hash({**entry, "hz": hz})
    meta_path = os.path.join(out_dir, "meta.json")
    if not force and os.path.exists(meta_path):
        try:
            old = json.load(open(meta_path))
            if old.get("entry_hash") == ehash and all(os.path.exists(os.path.join(out_dir, f)) for f in old.get("files", {}).values()):
                log(f"[{cid}] up to date (entry hash {ehash}); use --force to rebuild")
                return out_dir
        except Exception:
            pass
    t_req_a, t_req_b = float(entry["t_a"]), float(entry["t_b"])
    log(f"[{cid}] {rel_path} window {t_req_a:.1f}-{t_req_b:.1f} s, hz {hz}")
    T0 = time.time()

    # ---- 1. segments ---------------------------------------------------------------------
    segs, gaps = touched_segments(rdir, t_req_a, t_req_b, log)
    if not segs:
        raise ClipError(f"no segments cover the window (gaps: {gaps})")
    vsegs = [s for s in segs if s["video_needed"]]
    if not vsegs:
        raise ClipError("no video segment covers the window")
    for s in vsegs:
        if s["files"]["qcamera"] is None:
            raise ClipError(f"segment {s['seg']} has no qcamera.ts")
    for s in vsegs:
        if s["va"] is None:
            raise ClipError(f"segment {s['seg']} has no qRoadEncodeIdx")
    seg_nums = [s["seg"] for s in vsegs]
    if seg_nums != list(range(seg_nums[0], seg_nums[-1] + 1)):
        raise ClipError(f"video segments not contiguous: {seg_nums} (gaps {gaps})")
    started_vals = {s["started"] for s in segs}
    if len(started_vals) != 1:
        raise ClipError(f"startedMonoTime differs between segments: {started_vals}")
    started = started_vals.pop()

    # snap t_a to a video frame boundary of the first video segment -> frame k <-> t_a + k/20 exactly;
    # the duration is a whole number of 1/hz samples (1/hz must be a whole number of frames)
    if C.VIDEO_FPS % hz != 0:
        raise ClipError(f"hz {hz} must divide the video rate {C.VIDEO_FPS}")
    v0 = vsegs[0]["va"]["t_video0"]
    k0 = math.ceil((t_req_a - v0) / FRAME_DT - 1e-6)
    # the camera occasionally drops frames: snap to the first frame that really exists in the source .ts
    rel = source_frame_times(vsegs[0]["files"]["qcamera"], k0 * FRAME_DT, span=3.0)
    cand = [t for t in rel if t >= k0 * FRAME_DT - FRAME_DT / 2]
    if not cand:
        raise ClipError(f"no source video frame at/after {k0 * FRAME_DT:.3f} s in {vsegs[0]['files']['qcamera']}")
    k_first = int(round(cand[0] / FRAME_DT))
    if k_first != k0:
        log(f"  source frames {k0}..{k_first - 1} missing (camera drop); window start moved to frame {k_first}")
        k0 = k_first
    t_a = v0 + k0 * FRAME_DT
    dur = round((t_req_b - t_a) * hz) / hz
    t_b = t_a + dur
    vid_end = vsegs[-1]["vid_range"][1]
    if t_b > vid_end + 1e-3:
        dur = math.floor((vid_end - t_a) * hz) / hz
        t_b = t_a + dur
        log(f"  window trimmed to video end: t_b={t_b:.2f}")
    n = int(round(dur * hz))
    grid = np.array([t_a + k / hz for k in range(n)])
    log(f"  snapped window {t_a:.3f}-{t_b:.3f} s (dur {dur:.2f}, n={n}); video segs {seg_nums}; first frame offset {k0} frames")

    # seams between consecutive video segments
    seams = []
    for a, b in zip(vsegs, vsegs[1:]):
        seams.append(round(b["va"]["t_video0"] - a["vid_range"][1], 4))

    # ---- 2. lab decoder ----------------------------------------------------------------
    lab_frames, lab_infos, lab_warn = [], [], 0
    for s in segs:
        t0 = time.time()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            df, info = C.lab_decode(s["msgs"], car_dir)
        lab_warn += sum(1 for ln in buf.getvalue().splitlines() if ln.strip())
        info["seg"] = s["seg"]
        info["seconds"] = round(time.time() - t0, 1)
        lab_infos.append(info)
        lab_frames.append(df)
        log(f"  lab decode seg {s['seg']}: {info['n_rows']}x{info['n_cols']} in {info['seconds']} s via {info['reader']}")
    lab = pd.concat(lab_frames).sort_index()
    lab = lab[~lab.index.duplicated(keep="last")]
    lab_cols = sorted(lab.columns.tolist())

    # ---- 3. second pass: OP messages, spec CAN, echoes, gps, clocks ----------------------
    msgs_all = []
    for s in segs:
        msgs_all.extend(s["msgs"])
    op_on, blink, lcs, yl, yr, pl, pr = [], [], [], [], [], [], []
    gps, clocks = [], []
    for m in msgs_all:
        w = m.which()
        if w == "controlsState":
            op_on.append((C.rel_t(m, started), int(m.controlsState.enabled)))
        elif w == "carState":
            cs = m.carState
            blink.append((C.rel_t(m, started), 1 if cs.leftBlinker else (2 if cs.rightBlinker else 0)))
        elif w == "modelV2":
            mv = m.modelV2
            t = C.rel_t(m, started)
            lcs.append((t, int(mv.meta.laneChangeState.raw)))
            if len(mv.laneLines) >= 3 and len(mv.laneLineProbs) >= 3:
                yl.append((t, float(mv.laneLines[1].y[0])))
                yr.append((t, float(mv.laneLines[2].y[0])))
                pl.append((t, float(mv.laneLineProbs[1])))
                pr.append((t, float(mv.laneLineProbs[2])))
        elif w == "gpsLocation":
            g = m.gpsLocation
            if g.hasFix or (g.latitude != 0.0 and g.longitude != 0.0):
                gps.append((C.rel_t(m, started), g.latitude, g.longitude, g.altitude, g.speed, g.bearingDeg, int(g.unixTimestampMillis)))
        elif w == "clocks":
            clocks.append((C.rel_t(m, started), int(m.clocks.wallTimeNanos)))
    addrs = set(spec["addresses"])
    bus_of, bus_table, echoes = C.stock_bus_table(msgs_all, addrs)
    dec = C.spec_decode(msgs_all, mk, started, bus_of)
    echo_ts = C.echo_mask(msgs_all, spec["cmd_addrs"], started)
    log(f"  stock bus: { {hex(a): s for a, s in bus_of.items()} }  echoes(src>=128): {echoes or 'none'}  spec addrs decoded: {[hex(a) for a in sorted(dec)]}")

    # ---- 4. columns on the grid ----------------------------------------------------------
    TOL100, TOL20, TOL_ECHO = 0.02, 0.06, 0.15
    cols = {"t": [round(k / hz, 3) for k in range(n)]}
    src_map = {}

    def lab_col(name, tol=TOL100):
        if name in lab.columns:
            return resample(lab[name], grid, tol)
        return np.full(n, np.nan)

    cols["v_ego_mps"] = col_out(lab_col("vEgo"), "f"); src_map["v_ego_mps"] = "carState.vEgo (lab decoder)"
    cols["steer_angle_deg"] = col_out(lab_col("op_state_steer_angle"), "f"); src_map["steer_angle_deg"] = "carState.steeringAngleDeg (lab decoder)"
    units = {"v_ego_mps": "m/s", "steer_angle_deg": "deg", "lane_dev_m": "m", "lane_width_m": "m", "curvature_1pm": "1/m"}

    s, src = C.first_col(dec, spec["cols"].get("steer_torque"))
    cols["steer_torque"] = col_out(resample(s, grid), "f")
    src_map["steer_torque"] = f"0x{src[0]:X} {spec['addresses'][src[0]]['msg']}.{src[1]} (stock bus {bus_of.get(src[0])})" if src else None
    units["steer_torque"] = spec["units"].get("steer_torque")
    s, src = C.first_col(dec, spec["cols"].get("driver_torque"))
    if s is not None:
        cols["driver_torque"] = col_out(resample(s, grid), "f")
        src_map["driver_torque"] = f"0x{src[0]:X} {spec['addresses'][src[0]]['msg']}.{src[1]} (stock bus {bus_of.get(src[0])})"
        units["driver_torque"] = spec["units"].get("driver_torque")
    else:
        cols["driver_torque"] = col_out(lab_col("op_state_steer_torque"), "f")
        src_map["driver_torque"] = "carState.steeringTorque (lab decoder)"
        units["driver_torque"] = "carState.steeringTorque raw"

    s_on = C.eval_rules(spec["lka_on"], dec)
    cols["lka_on"] = col_out(resample(s_on, grid), "int")
    src_map["lka_on"] = spec["stock_lka_signal"] + " == " + str(spec["lka_on"][0]["in"])
    cols["op_on"] = col_out(resample(series_from(op_on), grid, TOL100), "int"); src_map["op_on"] = "controlsState.enabled"
    if echo_ts:
        e = resample(series_from([(t, 1.0) for t in echo_ts]), grid, TOL_ECHO)
        cols["op_tx"] = [0 if C.is_missing(x) else 1 for x in e]
    else:
        cols["op_tx"] = [0] * n
    src_map["op_tx"] = f"openpilot tx echo (src>=128) of {[hex(a) for a in spec['cmd_addrs']]} within ±{TOL_ECHO} s"
    cols["acc_on"] = col_out(lab_col("acc_enable"), "int"); src_map["acc_on"] = "carState.cruiseState.enabled (lab decoder)"
    for side in ("l", "r"):
        s, src = C.first_col(dec, spec["cols"].get(f"line_code_{side}"))
        cols[f"line_code_{side}"] = col_out(resample(s, grid), "int")
        src_map[f"line_code_{side}"] = f"0x{src[0]:X} {spec['addresses'][src[0]]['msg']}.{src[1]} (stock bus {bus_of.get(src[0])})" if src else None
    PL, PR = resample(series_from(pl), grid, TOL20), resample(series_from(pr), grid, TOL20)
    YL, YR = resample(series_from(yl), grid, TOL20), resample(series_from(yr), grid, TOL20)
    cols["op_prob_l"] = col_out(PL, "prob"); cols["op_prob_r"] = col_out(PR, "prob")
    src_map["op_prob_l"] = "modelV2.laneLineProbs[1]"; src_map["op_prob_r"] = "modelV2.laneLineProbs[2]"
    ok = np.fmin(PL, PR) >= 0.3
    dev = np.where(ok, (YL + YR) / 2.0, np.nan)
    width = np.where(ok, YR - YL, np.nan)
    cols["lane_dev_m"] = col_out(dev, "f"); cols["lane_width_m"] = col_out(width, "f")
    src_map["lane_dev_m"] = "(modelV2.laneLines[1].y[0] + laneLines[2].y[0]) / 2; null when min(prob_l, prob_r) < 0.3"
    src_map["lane_width_m"] = "modelV2.laneLines[2].y[0] - laneLines[1].y[0]; null when min(prob) < 0.3"
    # openpilot's controlsState.curvature is + right (planner frame); the schema documents + left, so negate
    cols["curvature_1pm"] = col_out(-lab_col("op_curvature_actual"), "f")
    src_map["curvature_1pm"] = "-controlsState.curvature (lab decoder op_curvature_actual; openpilot curvature is + right, negated to + left)"
    cols["brake"] = col_out(lab_col("state_brake"), "int"); src_map["brake"] = "carState.brakePressed (lab decoder)"
    cols["gas"] = col_out(lab_col("state_gas_pressed"), "int"); src_map["gas"] = "carState.gasPressed (lab decoder)"
    cols["steering_pressed"] = col_out(lab_col("op_steeringPressed"), "int"); src_map["steering_pressed"] = "carState.steeringPressed (lab decoder)"
    cols["blinker"] = col_out(resample(series_from(blink), grid, TOL100), "int"); src_map["blinker"] = "carState.leftBlinker/rightBlinker"
    cols["lane_change_state"] = col_out(resample(series_from(lcs), grid, TOL20), "int"); src_map["lane_change_state"] = "modelV2.meta.laneChangeState"
    cols = {k: cols[k] for k in C.SIGNAL_COLS}
    # make-specific extra columns (omitted when the address never appeared on the stock bus)
    extra = []
    for name, ex in (spec.get("extra_cols") or {}).items():
        s, src = C.first_col(dec, ex["src"])
        if s is None:
            continue
        cols[name] = col_out(resample(s, grid, ex.get("tol")), ex.get("kind", "f"))
        src_map[name] = f"0x{src[0]:X} {spec['addresses'][src[0]]['msg']}.{src[1]} (stock bus {bus_of.get(src[0])})"
        if ex.get("unit"):
            units[name] = ex["unit"]
        extra.append(name)
    for k, v in cols.items():
        assert len(v) == n, (k, len(v), n)

    # cross-check: lab decoder's own view of the stock state
    xcheck = None
    xcol = LAB_XCHECK.get(mk)
    if xcol and xcol in lab.columns:
        lab_on = resample(lab[xcol], grid, 0.05)  # lab df is on the 100 Hz vEgo index
        mine = np.array([np.nan if x is None else x for x in cols["lka_on"]], dtype="float64")
        both = ~np.isnan(lab_on) & ~np.isnan(mine)
        xcheck = {"lab_col": xcol, "agreement_pct": round(float(np.mean((lab_on[both] > 0.5) == (mine[both] > 0.5)) * 100), 2) if both.any() else None,
                  "n_compared": int(both.sum())}

    # ---- events / stats -----------------------------------------------------------------------
    sig_short = spec["stock_lka_signal"].split(" == ")[0].split(" in ")[0]
    events = detect_events(cols, hz, dur, sig=sig_short) if entry.get("auto_events", True) else []
    for e in entry.get("events", []) or []:
        tt = round(float(e["t"]) - t_a, 2)
        if 0 <= tt <= dur:
            events.append({"t": tt, "kind": e.get("kind", "custom"), "label": e.get("label", "")})
    events.sort(key=lambda e: e["t"])
    if entry.get("key_t") is not None:
        key = {"t": round(float(entry["key_t"]) - t_a, 2), "label": entry.get("key_label", "custom")}
        key["t"] = min(max(key["t"], 0.0), dur)
    else:
        key = pick_key_moment(events, dur)

    def pct(name):
        xs = [x for x in cols[name] if x is not None]
        return round(100.0 * sum(xs) / len(xs), 1) if xs else None

    def avail(name):
        return round(100.0 * sum(1 for x in cols[name] if x is not None) / n, 1)

    vv = [x for x in cols["v_ego_mps"] if x is not None]
    dd = [abs(x) for x in cols["lane_dev_m"] if x is not None]
    stats = {"v_max_mps": round(max(vv), 1) if vv else None, "v_mean_mps": round(sum(vv) / len(vv), 1) if vv else None,
             "v_min_mps": round(min(vv), 1) if vv else None,
             "dev_abs_max_m": round(max(dd), 2) if dd else None, "lka_active_pct": pct("lka_on"), "op_tx_pct": pct("op_tx"),
             "op_on_pct": pct("op_on"), "acc_on_pct": pct("acc_on")}
    availability = {k: avail(k) for k in cols if k != "t"}

    # eastern time at t_a: GPS time preferred (the wall clock is the device default on several 530075 routes)
    start_eastern, time_source, start_eastern_wall = None, None, None
    if clocks:
        tc, unix0 = clocks[0]
        start_eastern_wall = C.eastern_str(unix0 + (t_a - tc) * 1e9)
    gps_t = [(g[0], g[6]) for g in gps if g[6] > 1.5e12]
    if gps_t:
        tg, ms = gps_t[0]
        start_eastern, time_source = C.eastern_str(ms * 1e6 + (t_a - tg) * 1e9), "gpsLocation.unixTimestampMillis"
    else:
        start_eastern, time_source = start_eastern_wall, "clocks.wallTimeNanos"

    # ---- 5. video ----------------------------------------------------------------------------
    os.makedirs(out_dir, exist_ok=True)
    ss = t_a - v0
    mp4 = os.path.join(out_dir, "clip.mp4")
    crf, attempts, cut_check = encode_video(vsegs, ss, dur, k0, work, mp4, log, crf=int(entry.get("crf", 28)))
    probe = C.ffprobe(mp4)
    if abs(probe["duration"] - dur) > 0.2:
        raise ClipError(f"clip duration {probe['duration']} vs expected {dur}")
    exp_frames = int(round(dur * C.VIDEO_FPS))
    cut_check["expected_frames"] = exp_frames
    delta = (probe["nb_frames"] - exp_frames) if probe["nb_frames"] is not None else None
    cut_check["frame_count_delta"] = delta
    cut_check["dropped_frames"] = max(0, -delta) if delta is not None else None
    # pts are passed through, so dropped source frames only shorten the frame count (the player holds the last
    # frame); a surplus would mean a cut error
    if delta is not None and (delta > 1 or delta < -2 * C.VIDEO_FPS):
        raise ClipError(f"clip has {probe['nb_frames']} frames, expected {exp_frames}")
    if delta:
        log(f"  note: {abs(delta)} source frame(s) {'missing (camera drop)' if delta < 0 else 'extra'} inside the window")
    # alignment: per source segment, ffprobe start_time vs qRoadEncodeIdx timestampSof (+0.0148 s PTS offset)
    align = []
    for s in vsegs:
        p = C.ffprobe(s["files"]["qcamera"])
        err = p["start_time"] - s["va"]["sof_ns"] / 1e9 - C.SOF_TO_PTS_S
        align.append({"seg": s["seg"], "ffprobe_start_time": round(p["start_time"], 4), "sof_s": round(s["va"]["sof_ns"] / 1e9, 4),
                      "err_s": round(err, 4), "src_duration": round(p["duration"], 4), "src_frames": p["nb_frames"]})
    align_err = max(abs(a["err_s"]) for a in align)
    if align_err > C.ALIGN_TOL_S:
        raise ClipError(f"video/CAN alignment error {align_err:.4f} s > {C.ALIGN_TOL_S}")
    poster = os.path.join(out_dir, "poster.jpg")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{key['t']:.3f}", "-i", mp4, "-frames:v", "1", "-q:v", "4", poster], log)
    log(f"  video {probe['nb_frames']} frames {probe['duration']:.2f}s {os.path.getsize(mp4) / 1e6:.2f} MB crf {crf}; max align err {align_err:.4f}s; seams {seams}")

    # ---- 6. frames.json ---------------------------------------------------------------------------
    # dense block: every frame within +/-0.08 s of the key moment; background: for every second of the clip the
    # 3 stock-spec frames (stock bus) nearest that tick, so the ticker always has something to show
    db = C.load_dbc(spec["dbc"])
    key_route_t = t_a + key["t"]
    DENSE, BG_PER_TICK = 0.08, 3
    dense, stock_spec_frames = [], []
    for m in msgs_all:
        if m.which() != "can":
            continue
        t = C.rel_t(m, started)
        if t < t_a - 0.5 or t > t_b + 0.5:
            continue
        in_dense = abs(t - key_route_t) <= DENSE
        for f in m.can:
            if in_dense:
                dense.append((t, f.src, f.address, bytes(f.dat)))
            elif f.address in addrs and f.src == bus_of.get(f.address):
                stock_spec_frames.append((t, f.src, f.address, bytes(f.dat)))
    stock_spec_frames.sort(key=lambda r: r[0])
    import bisect
    ssf_t = [r[0] for r in stock_spec_frames]
    background = []
    for tick in range(0, int(math.floor(dur)) + 1):
        target = t_a + tick
        i = bisect.bisect_left(ssf_t, target)
        cand = stock_spec_frames[max(0, i - 6): i + 6]
        cand.sort(key=lambda r: abs(r[0] - target))
        background.extend(cand[:BG_PER_TICK])

    def frame_rec(t, src, a, dat):
        rec = {"t": round(t - t_a, 3), "bus": src, "addr": a, "addr_hex": f"0x{a:03X}", "dlc": len(dat), "data": dat.hex(), "msg": None, "signals": None}
        try:
            mdef = db.get_message_by_frame_id(a)
            rec["msg"] = mdef.name
            if a in addrs and src == bus_of.get(a):
                d = db.decode_message(a, dat, decode_choices=False, allow_truncated=True)
                want = spec["addresses"][a]["signals"]
                rec["signals"] = {k: (C.num(v, 3) if isinstance(v, float) else v) for k, v in d.items() if (k in want) or (k not in ("CHECKSUM", "COUNTER") and len(want) == 0)}
        except KeyError:
            pass
        return rec

    def rec_size(rec):
        return len(json.dumps(rec, separators=(",", ":"))) + 1

    # mandatory: background + dense stock-spec frames; then fill with the other dense frames nearest the key moment
    mandatory = [frame_rec(*r) for r in background] + [frame_rec(*r) for r in dense if r[2] in addrs and r[1] == bus_of.get(r[2])]
    budget_bytes, budget_n = C.CAPS["frames"] - 1500, C.CAPS["frames_n"]
    used = sum(rec_size(r) for r in mandatory)
    while (used > budget_bytes or len(mandatory) > budget_n) and BG_PER_TICK > 1:
        BG_PER_TICK -= 1
        background = background[:: 2] if BG_PER_TICK == 1 else [r for i, r in enumerate(background) if i % 3 != 2]
        mandatory = [frame_rec(*r) for r in background] + [frame_rec(*r) for r in dense if r[2] in addrs and r[1] == bus_of.get(r[2])]
        used = sum(rec_size(r) for r in mandatory)
    extra_frames = []
    others = sorted((r for r in dense if not (r[2] in addrs and r[1] == bus_of.get(r[2]))), key=lambda r: abs(r[0] - key_route_t))
    for r in others:
        rec = frame_rec(*r)
        s = rec_size(rec)
        if used + s > budget_bytes or len(mandatory) + len(extra_frames) >= budget_n:
            break
        extra_frames.append(rec)
        used += s
    frames = sorted(mandatory + extra_frames, key=lambda r: (r["t"], r["bus"], r["addr"]))
    frames_obj = {"version": 1, "clip": cid, "moment": key, "dbc": [C.dbc_info(spec["dbc"])], "bus_roles": spec["bus_roles"],
                  "stock_bus": {f"0x{a:03X}": s for a, s in bus_of.items()},
                  "sampling": {"dense_window_s": round(2 * DENSE, 2), "background_hz": 1, "background_per_tick": BG_PER_TICK,
                               "n_dense": len(frames) - len(background), "n_background": len(background)},
                  "frames": frames}
    fpath = os.path.join(out_dir, "frames.json")
    size = C.write_json(fpath, frames_obj)
    while size > C.CAPS["frames"] and len(frames_obj["frames"]) > 60:
        frames_obj["frames"] = frames_obj["frames"][: int(len(frames_obj["frames"]) * 0.9)]
        size = C.write_json(fpath, frames_obj)

    # ---- track.json -------------------------------------------------------------------------------
    pts = []
    for t, lat, lon, alt, spd, brg, _ms in gps:
        if t_a - 0.5 <= t <= t_b + 0.5:
            k = min(max(int(round((t - t_a) * hz)), 0), n - 1)
            pts.append([round(t - t_a, 2), round(lat, 6), round(lon, 6), C.num(alt, 1), C.num(spd, 2), C.num(brg, 1), cols["lka_on"][k]])
    track = {"version": 1, "clip": cid, "hz": 1, "source": "gpsLocation",
             "bbox": [round(min(p[2] for p in pts), 6), round(min(p[1] for p in pts), 6), round(max(p[2] for p in pts), 6), round(max(p[1] for p in pts), 6)] if pts else None,
             "pts": [p[:6] for p in pts], "lka_on": [p[6] for p in pts]}
    C.write_json(os.path.join(out_dir, "track.json"), track)

    make, model = C.CAR_NAMES.get(car_dir, (car_dir, ""))
    # ---- signals.json ------------------------------------------------------------------------------
    codes = dict(C.CODES)
    if spec.get("line_code"):
        codes["line_code"] = spec["line_code"]
        codes["line_code_level"] = spec.get("line_code_level")
        codes["line_code_note"] = spec.get("line_code_note", "")
    else:
        codes["line_code"] = None
        codes["line_code_level"] = None
        codes["line_code_note"] = f"{make} does not broadcast a lane-line code on the stock bus; line_code_l/r are null."
    signals = {"version": 1, "clip": cid, "hz": hz, "n": n, "duration_s": round(dur, 3), "t0_route_s": round(t_a, 3), "t0_video_s": 0.0,
               "sign": C.SIGN, "units": {k: v for k, v in units.items() if v}, "codes": codes, "extra": extra, "cols": cols, "events": events, "stats": stats}
    spath = os.path.join(out_dir, "signals.json")
    ssize = C.write_json(spath, signals)
    if ssize > C.CAPS["signals"]:
        raise ClipError(f"signals.json {ssize} B > cap {C.CAPS['signals']}")

    # ---- meta.json -------------------------------------------------------------------------------------
    fp = {m.carParams.carFingerprint for s in segs for m in s["msgs"] if m.which() == "carParams"}
    stock_pct = stats["lka_active_pct"]
    sysname = spec.get("system_name", "lane centering")
    if entry.get("system_label"):
        system_label = entry["system_label"]
    elif stats["op_tx_pct"]:
        system_label = f"openpilot steering ({stats['op_tx_pct']}% of the clip); stock {make} {sysname} telemetry shown"
    else:
        system_label = f"Stock {make} {sysname} active {stock_pct}% of the clip; openpilot not transmitting"
    if entry.get("blurb") and len(entry["blurb"]) > 220:
        log(f"  warning: blurb is {len(entry['blurb'])} chars (> 220)")
    where_latlon = [pts[len(pts) // 2][1], pts[len(pts) // 2][2]] if pts else None
    files = {"video": "clip.mp4", "poster": "poster.jpg", "signals": "signals.json", "track": "track.json", "frames": "frames.json"}
    meta = {
        "version": 1, "pipeline_version": C.PIPELINE_VERSION, "entry_hash": ehash, "generated": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "id": cid, "title": entry.get("title", f"{make} {model}"), "make": make, "model": model, "make_key": mk, "car_dir": car_dir,
        "fingerprint": sorted(fp), "dongle": dongle, "route": route, "rel_path": rel_path, "segments": seg_nums,
        "segments_decoded": [s["seg"] for s in segs], "t_route": [round(t_a, 3), round(t_b, 3)], "t_route_requested": [t_req_a, t_req_b],
        "duration_s": round(dur, 3), "hz": hz, "n": n, "start_eastern": start_eastern, "time_source": time_source, "start_eastern_wall_clock": start_eastern_wall,
        "where": entry.get("where"), "where_latlon": where_latlon,
        "scene": entry.get("scene", []), "extra_cols": extra,
        "system_label": system_label, "stock_lka_signal": spec["stock_lka_signal"], "blurb": entry.get("blurb"), "default": bool(entry.get("default", False)),
        "decoder": {"module": "CAN_decoder_functions", "function": lab_infos[0]["decoder"], "ext_dict": lab_infos[0]["ext_dict"], "reader": sorted({i["reader"] for i in lab_infos}),
                    "dir": os.path.basename(C.LAB_DIR.rstrip("/")), "repo_commit": C.decoder_commit(), "per_segment": [{k: v for k, v in i.items() if k in ("seg", "n_rows", "n_cols", "seconds", "file_prefix")} for i in lab_infos],
                    "columns": lab_cols, "n_columns": len(lab_cols), "warnings_printed": lab_warn, "openpilot_dir": os.path.basename(C.OP_DIR.rstrip("/"))},
        "dbc": [C.dbc_info(spec["dbc"])], "stock_spec_verified": spec.get("verified", False),
        "can": {"stock_bus": {f"0x{a:03X}": s for a, s in bus_of.items()}, "bus_table": {f"0x{a:03X}": {str(s): c for s, c in d.items()} for a, d in bus_table.items()},
                "echo_counts": {f"0x{a:03X}": c for a, c in echoes.items()}, "n_echo_frames": len(echo_ts), "spec_addrs_decoded": [f"0x{a:03X}" for a in sorted(dec)]},
        "column_sources": src_map, "availability_pct": availability, "stats": stats, "lab_crosscheck": xcheck,
        "video": {"fps": C.VIDEO_FPS, "width": probe["width"], "height": probe["height"], "codec": "libx264", "crf": crf, "attempts": attempts, "bytes": os.path.getsize(mp4),
                  "nb_frames": probe["nb_frames"], "duration_s": round(probe["duration"], 3), "t_video0_first_seg": round(v0, 4), "first_frame_offset": k0,
                  "snap_shift_s": round(t_a - t_req_a, 4), "alignment": align, "alignment_err_s": round(align_err, 4), "segment_seams_s": seams, "cut_check": cut_check,
                  "sof_to_pts_s": C.SOF_TO_PTS_S, "source": [os.path.basename(s["files"]["qcamera"]) for s in vsegs]},
        "key_moment": key, "n_events": len(events),
        "privacy": {"source_blurred": False, "resolution": f"{C.VIDEO_W}x{C.VIDEO_H}", "manual_review": "pending", "notes": "highway window; review poster + sampled frames by eye before publishing"},
        "files": files, "bytes": {}, "sha256": {}, "build_seconds": round(time.time() - T0, 1),
    }
    for k, f in files.items():
        p = os.path.join(out_dir, f)
        meta["bytes"][k] = os.path.getsize(p)
        meta["sha256"][k] = C.sha256_file(p)
    C.write_json(meta_path, meta, compact=False)
    log(f"  wrote {out_dir} ({sum(meta['bytes'].values()) / 1e6:.2f} MB) in {meta['build_seconds']} s; lka_on {stats['lka_active_pct']}% op_tx {stats['op_tx_pct']}% events {len(events)} key {key}")
    return out_dir


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "clips.yaml"))
    ap.add_argument("--id", action="append", help="clip id (repeatable)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--hz", type=int, default=None, help="override sample rate (default: clips.yaml defaults.hz or 10)")
    ap.add_argument("--out", default=os.path.join(C.SITE_DIR, "can"))
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=1, help="export up to N clips in parallel (<= 4)")
    args = ap.parse_args()
    C.nice()
    clips = load_clips(args.spec)
    if args.all:
        todo = clips
    elif args.id:
        todo = [c for c in clips if c["id"] in set(args.id)]
        missing = set(args.id) - {c["id"] for c in todo}
        if missing:
            ap.error(f"unknown clip id(s): {sorted(missing)}")
    else:
        ap.error("--id or --all required")
    tasks = [(e, args.out, args.hz or int(e.get("hz", 10)), args.force) for e in todo]
    rc = 0
    if args.jobs > 1 and len(tasks) > 1:
        from concurrent.futures import ProcessPoolExecutor
        with ProcessPoolExecutor(min(args.jobs, 4)) as ex:
            for cid, ok, err in ex.map(_run_one, tasks):
                if not ok:
                    print(f"[{cid}] FAILED: {err}", file=sys.stderr)
                    rc = 2
    else:
        for t in tasks:
            cid, ok, err = _run_one(t)
            if not ok:
                print(f"[{cid}] FAILED: {err}", file=sys.stderr)
                rc = 2
    sys.exit(rc)


def _run_one(task):
    entry, out, hz, force = task
    C.nice()
    try:
        export(entry, out, hz, force)
        return entry["id"], True, None
    except ClipError as ex:
        return entry["id"], False, str(ex)
    except Exception as ex:  # keep the batch going, report the traceback
        import traceback
        return entry["id"], False, f"{type(ex).__name__}: {ex}\n{traceback.format_exc()[-1500:]}"


if __name__ == "__main__":
    main()
