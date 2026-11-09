#!/usr/bin/env python3
"""CANTraj project page exports (WP-A, part 1): trajectories (traj_index, traj_ex1..6), Scrubber signals (signals_ex1..6),
kit-widget files (five bars/1, paired_complementarity), media copy + checks, sources, numbers, manifest, SHA256SUMS and the
thumbnail. The eleven table/1 chart files (board … confidence) come from cantraj_charts_data.export_all(put) (WP-A part 2).

Run from the repository root:
  PYTHONPATH=<paper>/src CANTRAJ_BENCH=<bench cache> CANTRAJ_GPS=<gps csvs> CANTRAJ_MANIFESTS=<paper>/manifests \
  CANTRAJ_HF=<released data staging> CANTRAJ_WORK=<page work folder> <venv python3> tools/projpipe/cantraj_export.py \
  [--skip-cdf] [--only traj,signals,charts,paired,sources,thumbnail]   (bars, media, numbers and the manifest always run)
Inputs are read-only (paper project, released data staging, benchmark cache, the page work folder with media/ and
data/examples.json). Outputs: cantraj/static/{data,media,SHA256SUMS} and images/th_cantraj.jpg. Every JSON goes through
common.write_json (privacy gate) and is re-read against the page's own forbidden-string rule; every number that the
registry block states for the corpus is recomputed from the released manifests and compared before anything is written."""
import os, sys, glob, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, resample, ffprobe, sha256_file, entry_hash
sys.dont_write_bytecode = True      # the paper project is read-only: no __pycache__ writes from importing its modules
import argparse, inspect, math, shutil
import numpy as np
import pandas as pd
PAPER = os.environ.get("CANTRAJ_PAPER", "/home/henry/Desktop/Drive/DriveDNA/GPS")
HF = os.environ.get("CANTRAJ_HF", "/data/backup/DriveDNA-GPS_hf")
BENCH = os.environ.get("CANTRAJ_BENCH", "/data/backup/DriveDNA-GPS_bench")
WORK = os.environ.get("CANTRAJ_WORK", os.path.join(PATHS["work"], "cantraj"))
os.environ.setdefault("CANTRAJ_BENCH", BENCH); os.environ.setdefault("CANTRAJ_MANIFESTS", os.path.join(PAPER, "manifests"))
sys.path.insert(0, os.path.join(PAPER, "src")); sys.path.insert(0, os.path.join(PAPER, "scripts"))
import icde_tables as T  # noqa: E402,F401  (paper tables; the chart module mirrors their row selections)
import icde_figures as F  # noqa: E402,F401
try:
    import cantraj_charts_data as CD  # noqa: E402  (WP-A part 2: the eleven table/1 chart files)
except ImportError as e:
    sys.exit(f"ABORT: tools/projpipe/cantraj_charts_data.py (WP-A part 2) is missing or does not import: {e}")
import validate as V  # noqa: E402  (schema/privacy checks of the kit, applied to the signals files here)

REPO = PATHS["repo"]; PAGE = os.path.join(REPO, "cantraj"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media")
TABLES = os.path.join(PAPER, "reports", "icde", "tables"); FIGDATA = os.path.join(PAPER, "reports", "icde", "figures_data")
TODAY = "2026-11-09"; BENCH_VERSION = "benchmark v1.1 (2026-10-28)"; REVIEWER = "claude+henry (user look pending)"
# page rule (SPEC §0.2) checked on the written text of every JSON; "static/data/…" is the page's own folder, not a local path
BAD = re.compile(r"icde|submission|anonymous|double-blind|device|/home/|(?<![A-Za-z0-9_])/data/", re.I)
ap = argparse.ArgumentParser(); ap.add_argument("--skip-cdf", action="store_true"); ap.add_argument("--only", default="")
A = ap.parse_args(); ONLY = {x.strip() for x in A.only.split(",") if x.strip()}
def want(group): return not ONLY or group in ONLY
for d in (DATA, MEDIA): os.makedirs(d, exist_ok=True)

files, items, RECOMPUTED = {}, {}, {}
def fail(msg): print("ABORT:", msg); sys.exit(1)
def put(key, name, obj, first_view=False):
    if obj.get("schema") == "table/1":     # §3.0: every column has exactly n entries (also guards the chart module's files)
        short = [c for c, v in obj.get("cols", {}).items() if len(v) != obj.get("n")]
        if short: fail(f"{name}: columns {short} do not have n = {obj.get('n')} entries")
    p = os.path.join(DATA, name); n, h = write_json(p, obj)
    txt = open(p, encoding="utf8").read(); m = BAD.search(txt)
    if m: os.remove(p); fail(f"{name}: forbidden string {m.group(0)!r} at offset {m.start()}")
    if n > CAPS["json_bytes"]: os.remove(p); fail(f"{name}: {n:,} B > json cap {CAPS['json_bytes']:,}")
    files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}
    print(f"  data  {name:28s} {n/1024:7.1f} KB" + ("  · first view" if first_view else ""))
def register_existing(key, name, first_view=False):
    p = os.path.join(DATA, name)
    if not os.path.exists(p): fail(f"--only/--skip-cdf: {name} is not on disk yet; run the full export first")
    files[key] = {"path": "static/data/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p), "first_view": first_view}
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}
def check(cond, msg):
    if not cond: fail(msg)
def close(a, b, tol=1e-9): return a is not None and b is not None and abs(float(a) - float(b)) <= tol

FIRST_VIEW = {"traj_index": True, "traj_ex4": True, "signals_ex4": True}
GROUPS = {"traj": [f"traj_ex{i}" for i in range(1, 7)] + ["traj_index"], "signals": [f"signals_ex{i}" for i in range(1, 7)], "charts": list(CD.KEYS),
          "bars": ["bars_windows", "bars_durations", "bars_drivers", "bars_brands", "bars_common_failure"], "paired": ["paired_complementarity"], "sources": ["sources"]}
def skip_group(g):
    print(f"  (skipping {g}: registering the files on disk)")
    for k in GROUPS[g]: register_existing(k, k + ".json", FIRST_VIEW.get(k, False))

# ---------------------------------------------------------------- shared loaders (read-only inputs)
_C = {}
def episodes():
    if "ep" not in _C:
        _C["ep"] = pd.read_parquet(os.path.join(HF, "benchmark", "manifests", "episode_manifest_v1.parquet"),
                                   columns=["episode_id", "driver", "drive", "win", "fold", "t0_s", "dur_s", "path_len_m", "eligible_main", "platform", "gps_source", "set"])
    return _C["ep"]
def release_manifest():   # only these columns are ever read: the manifest also carries median coordinates, which never leave this function
    if "rm" not in _C: _C["rm"] = pd.read_csv(os.path.join(HF, "manifest.csv"), usecols=["set", "driver", "drive", "status", "trim_lo_s", "trim_hi_s", "gps_sources", "gps_rate_hz"])
    return _C["rm"]
def media_index():
    if "mi" not in _C: _C["mi"] = json.load(open(os.path.join(WORK, "media", "media_index.json")))
    return _C["mi"]

# ---------------------------------------------------------------- V01 trajectories: traj_index, traj_ex1..6 (§3.1)
EXPECT = {  # window → (episode, density class, path km, fold, ADE beam, ADE filter, reference seconds, box or None)
    "ex1": ("driver_266/drive_002/w05/k001", "suburb", 5.15, "test", 1.36, 2.41, 299, [-400, 4534, -3878, 1056]),
    "ex2": ("driver_099/drive_007/w05/k114", "rural", 9.35, "test", 3.25, 5.28, 299, None),
    "ex3": ("driver_238/drive_001/w05/k001", "suburb", 4.11, "few_shot_heldout", 3.76, 4.56, 300, None),
    "ex4": ("driver_104/drive_002/w05/k024", "urban", 2.94, "few_shot_heldout", 4.04, 4.42, 299, [-2581, 218, -911, 1888]),
    "ex5": ("driver_250/drive_014/w05/k002", "rural", 4.35, "few_shot_heldout", 5.15, 5.21, 300, None),
    "ex6": ("driver_096/drive_001/w05/k000", "urban", 4.82, "test", 5.75, 11.51, 295, None)}
FOLD_LABEL = {"test": "test drivers", "few_shot_heldout": "few-shot drivers"}
SERIES = [{"key": "ref", "label": "GNSS reference", "slot": "ink", "style": "online", "marker": None},
          {"key": "beam", "label": "offline beam · speed + steering", "slot": 2, "style": "offline", "marker": None},
          {"key": "filter", "label": "online filter · speed + steering", "slot": 2, "style": "online", "marker": None}]
METHODS = {"beam": "offline map beam, speed + steering, start and heading known (F-M-Hp)",
           "filter": "online map particle filter, speed + steering, start and heading known (O-M-Hp)", "reference": "GNSS reference at 1 Hz"}
FRAME = "metres east (x) / north (y) of the window's given start; t_rel_s = seconds after the window start"
UNITS_TRAJ = {"t_rel_s": "s", "ref_x": "m", "ref_y": "m", "beam_x": "m", "beam_y": "m", "filter_x": "m", "filter_y": "m", "err_beam_m": "m", "err_filter_m": "m"}
INDEX_COLS = ["id", "label", "density_class", "path_km", "fold", "fold_label", "episode_id", "nodes_per_km2", "n_turns", "ade_beam_m", "ade_filter_m", "file_key", "signals_key",
              "clip_key", "poster_key", "clip_t0_rel_s", "clip_dur_s", "frame_t_rel_s", "window_s", "theta0_rad", "box_m", "n_ref"]

def fnan(a): return np.array([np.nan if v is None else v for v in a], dtype=float)
def paper_positions():
    """The paper's own figure export (2 dp positions at the same reference seconds) → {(example, series): (t, x, y)}; None if absent."""
    p = os.path.join(FIGDATA, "fig_examples.csv")
    if not os.path.exists(p): return None
    out = {}
    for (k, s), g in pd.read_csv(p).groupby(["example", "series"]): out[(int(k), s)] = (g.t_rel_s.to_numpy(float), g.x_m.to_numpy(float), g.y_m.to_numpy(float))
    return out

def traj():
    EX = json.load(open(os.path.join(WORK, "data", "examples.json")))
    check(EX.get("schema") == "cantraj_examples/1", "examples.json schema")
    ws = EX["windows"]; check([w["id"] for w in ws] == [f"ex{i}" for i in range(1, 7)], "examples.json window ids")
    PP = paper_positions(); idx = {c: [] for c in INDEX_COLS}; out = {}
    for k, w in enumerate(ws, start=1):
        wid = w["id"]; e = EXPECT[wid]
        check(w["episode_id"] == e[0] and w["density_class"] == e[1] and close(w["path_km"], e[2]) and w["fold"] == e[3], f"{wid}: window facts differ from §3.1")
        check(close(w["ade_beam_m"], e[4]) and close(w["ade_filter_m"], e[5]), f"{wid}: ADE differs from §3.1")
        t = [round(float(v), 1) for v in w["reference"]["t_rel_s"]]; n = len(t)
        check(n == e[6] and all(t[i] > t[i - 1] for i in range(1, n)), f"{wid}: {n} reference seconds (expected {e[6]}) or t not increasing")
        check(e[7] is None or list(w["box_m"]) == e[7], f"{wid}: box differs from §3.1")
        check(w["missing_predictions"] == [], f"{wid}: missing predictions {w['missing_predictions']}")
        rx, ry = fnan(w["reference"]["x_m"]), fnan(w["reference"]["y_m"]); check(np.isfinite(rx).all() and np.isfinite(ry).all(), f"{wid}: reference has gaps")
        cols = {"t_rel_s": t, "ref_x": [int(v) for v in w["reference"]["x_m"]], "ref_y": [int(v) for v in w["reference"]["y_m"]]}
        errs = {}
        for key in ("beam", "filter"):
            xs, ys = fnan(w[key]["x_m"]), fnan(w[key]["y_m"]); have = np.isfinite(xs) & np.isfinite(ys)
            cols[f"{key}_x"] = [None if not h else int(v) for h, v in zip(have, xs)]; cols[f"{key}_y"] = [None if not h else int(v) for h, v in zip(have, ys)]
            src = ref = None
            if PP: src, ref = PP.get((k, key)), PP.get((k, "reference"))
            if (src is not None and ref is not None and len(src[0]) == n and len(ref[0]) == n and np.max(np.abs(src[0] - np.array(t))) < 0.051
                    and np.nanmax(np.abs(src[1] - xs)) <= 0.51 and np.nanmax(np.abs(src[2] - ys)) <= 0.51 and np.max(np.abs(ref[1] - rx)) <= 0.51):
                d = np.hypot(src[1] - ref[1], src[2] - ref[2]); tol, how = 0.02, "paper positions (2 dp)"      # the paper's own 2 dp positions: exact errors
            else:
                d = np.hypot(xs - rx, ys - ry); tol, how = 0.15, "integer-metre positions"
            err = [None if not h else round(float(v), 1) for h, v in zip(have, d)]
            m = float(np.nanmean(np.where(have, d, np.nan))); check(abs(m - w[f"ade_{key}_m"]) < tol, f"{wid}: mean {key} error {m:.3f} vs ADE {w[f'ade_{key}_m']} ({how})")
            cols[f"err_{key}_m"] = err; errs[key] = (err, how)
        cands = []
        for c in w.get("beam_candidates", []):
            check(len(c["x_m"]) == n and len(c["y_m"]) == n, f"{wid}: candidate {c['candidate_id']} length")
            cands.append({"id": int(c["candidate_id"]), "x": [None if v is None else int(v) for v in c["x_m"]], "y": [None if v is None else int(v) for v in c["y_m"]]})
        check((wid == "ex4") == (len(cands) == 9) and [c["id"] for c in cands] == (list(range(1, 10)) if wid == "ex4" else []), f"{wid}: candidates")
        label = w["label"]; meta_w = {"id": wid, "label": label, "density_class": w["density_class"], "path_km": num(w["path_km"], 2), "fold": w["fold"], "fold_label": FOLD_LABEL[w["fold"]],
                                      "episode_id": w["episode_id"], "nodes_per_km2": num(w["nodes_per_km2"], 1), "n_turns": int(w["n_turns"]), "ade_beam_m": num(w["ade_beam_m"], 2),
                                      "ade_filter_m": num(w["ade_filter_m"], 2), "file_key": f"traj_ex{k}", "signals_key": f"signals_ex{k}", "clip_key": f"media_ex{k}", "poster_key": f"poster_ex{k}",
                                      "clip_t0_rel_s": 138.0, "clip_dur_s": 24.0, "frame_t_rel_s": 150.0, "window_s": 300.0, "theta0_rad": num(w["theta0_rad"], 4),
                                      "box_m": [int(v) for v in w["box_m"]], "n_ref": n}
        for c in INDEX_COLS: idx[c].append(meta_w[c])
        roads = w["roads"]
        obj = {"schema": "table/1", "id": f"traj_ex{k}", "caption": f"{label}: GNSS reference, offline beam and online filter positions at the reference seconds, in metres from the given start, with the visible roads.",
               "n": n, "cols": cols, "roads": roads, "candidates": cands,
               "meta": {**meta_w, "generated": TODAY, "source": "examples export of the paper figure (reference, beam and filter positions; visible roads of the published tiles)", "benchmark": BENCH_VERSION,
                        "units": UNITS_TRAJ, "series": SERIES, "methods": METHODS, "roads_note": EX["roads_note"], "n_roads": len(roads), "n_road_points": int(sum(len(r) for r in roads)),
                        "notes": [f"errors from the {errs['beam'][1]}; null where the method has no output at that second", f"candidates: the beam's nine other candidate paths (ex4 only)" if cands else "candidates: none (only the examples figure's pipeline window carries them)"]}}
        put(f"traj_ex{k}", f"traj_ex{k}.json", obj, first_view=(wid == "ex4"))
        out[wid] = {"t": t, "err_beam": cols["err_beam_m"], "err_filter": cols["err_filter_m"], "ref_x": rx, "ref_y": ry, "episode_id": w["episode_id"], "label": label}
    put("traj_index", "traj_index.json", {"schema": "table/1", "id": "traj_index", "caption": "The six recovered five-minute windows of the examples figure: facts, files and the frame of each window.",
        "n": 6, "cols": idx, "meta": {"generated": TODAY, "source": "examples export of the paper figure; episode manifest v1 (fold, path length); density manifest v1.1", "benchmark": BENCH_VERSION,
                                     "units": {"path_km": "km", "nodes_per_km2": "nodes/km²", "ade_beam_m": "m", "ade_filter_m": "m", "clip_t0_rel_s": "s", "clip_dur_s": "s", "frame_t_rel_s": "s", "window_s": "s", "theta0_rad": "rad", "box_m": "m"},
                                     "default_window": "ex4", "order": [f"ex{i}" for i in range(1, 7)], "frame": FRAME,
                                     "notes": ["box_m = [x0, x1, y0, y1], the paper's square box around the reference path", "clip time s = window second clip_t0_rel_s + s; the mid-window camera frame is at frame_t_rel_s"]}}, first_view=True)
    return out

def load_traj_from_disk():
    out = {}
    for k in range(1, 7):
        o = json.load(open(os.path.join(DATA, f"traj_ex{k}.json"))); c = o["cols"]
        out[f"ex{k}"] = {"t": c["t_rel_s"], "err_beam": c["err_beam_m"], "err_filter": c["err_filter_m"], "ref_x": fnan(c["ref_x"]), "ref_y": fnan(c["ref_y"]), "episode_id": o["meta"]["episode_id"], "label": o["meta"]["label"]}
    return out

# ---------------------------------------------------------------- V01 signals: signals_ex1..6 (§3.2)
def interp_err(t_ref, err, tq):
    """linear interpolation of the per-second errors onto tq; None where either neighbour is None or tq is outside the span."""
    t_ref = np.asarray(t_ref, float); out = []
    for q in tq:
        i = int(np.searchsorted(t_ref, q, side="right")); a, b = i - 1, i
        if a < 0 or b >= len(t_ref) or err[a] is None or err[b] is None: out.append(None); continue
        u = (q - t_ref[a]) / (t_ref[b] - t_ref[a]); out.append(round(float(err[a] * (1 - u) + err[b] * u), 1))
    return out
def ladder(v):
    for L in (5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000):
        if L >= v: return max(L, 10)
    fail(f"error range {v} beyond the ladder")

def signals(TR):
    MI = media_index(); vids = {it["file"][:-4]: it for it in MI["items"] if it["kind"] == "video" and it["file"].startswith("ex")}
    ep = episodes().set_index("episode_id")
    for k in range(1, 7):
        wid = f"ex{k}"; tr = TR[wid]; v = vids[wid]; drv, drive = tr["episode_id"].split("/")[:2]
        check(v["episode_id"] == tr["episode_id"], f"{wid}: media ledger episode differs")
        t0 = float(v["window_t0_drive_s"]); check(abs(t0 - float(ep.loc[tr["episode_id"], "t0_s"])) < 0.01, f"{wid}: window start differs between the media ledger and the episode manifest")
        cs = pd.read_parquet(os.path.join(HF, "events", drv, drive, "carstate.parquet"), columns=["t_s", "vEgo", "steeringAngleDeg"])
        ts = cs["t_s"].to_numpy(float) - t0; tn = 138.0 + np.arange(240) / 10.0; tcol = [round(138 + i / 10, 1) for i in range(240)]
        spd = [None if x is None else round(x, 2) for x in resample(ts, cs["vEgo"].to_numpy(float), tn, kind="linear", tol=0.25)]
        ste = [None if x is None else round(x, 1) for x in resample(ts, cs["steeringAngleDeg"].to_numpy(float), tn, kind="linear", tol=0.25)]
        check(sum(x is not None for x in spd) >= 200, f"{wid}: speed has too many gaps over the clip")
        eb = interp_err(tr["t"], tr["err_beam"], tn); ef = interp_err(tr["t"], tr["err_filter"], tn)
        # alignment sanity: CAN speed against the speed of the GNSS reference over the clip (receiver lag ≤ 0.7 s is expected)
        t_ref = np.asarray(tr["t"], float); vref = np.hypot(np.diff(tr["ref_x"]), np.diff(tr["ref_y"])) / np.diff(t_ref); vq = np.interp(tn, (t_ref[1:] + t_ref[:-1]) / 2, vref)
        dv = float(np.nanmedian(np.abs(fnan(spd) - vq))); check(dv < 3.0, f"{wid}: CAN speed and reference speed disagree (median {dv:.2f} m/s): clock misaligned?")
        emax = max([x for x in eb + ef if x is not None] or [0.0]); R = ladder(emax * 1.15)
        pr = ffprobe(os.path.join(WORK, "media", f"{wid}.mp4")); check(pr["width"] == 640 and pr["height"] == 402, f"{wid}.mp4 is {pr['width']}×{pr['height']}")
        sig = {"schema": "signals/1", "id": wid, "hz": 10, "n": 240, "t0": 138.0, "duration_s": 24.0,
               "cols": {"t": tcol, "v_ego_mps": spd, "steer_deg": ste, "err_beam_m": eb, "err_filter_m": ef},
               "labels": {"v_ego_mps": "speed", "steer_deg": "steering angle", "err_beam_m": "offline beam error", "err_filter_m": "online filter error"},
               "units": {"v_ego_mps": "m/s", "steer_deg": "deg", "err_beam_m": "m", "err_filter_m": "m"}, "ranges": {"err_beam_m": [0, R], "err_filter_m": [0, R]},
               "events": [{"t": 150.0, "kind": "frame", "label": "mid-window camera frame (not an input)", "glyph": "▣"}],
               "media": {"video": f"static/media/{wid}.mp4", "poster": f"static/media/{wid}.jpg", "aspect": f"{pr['width']}/{pr['height']}"},
               "meta": {"episode_id": tr["episode_id"], "label": tr["label"], "clip_t0_rel_s": 138.0, "window_s": 300,
                        "source": "released event table (vEgo, steeringAngleDeg) resampled to 10 Hz; errors from the window's reference, beam and filter positions at reference seconds, linearly interpolated"}}
        check(sig["t0"] == sig["cols"]["t"][0] == 138.0 and not re.search(r"alert|onset|takeover|warn", sig["events"][0]["kind"], re.I), f"{wid}: t0/event")
        put(f"signals_ex{k}", f"signals_ex{k}.json", sig, first_view=(wid == "ex4"))
        probs = V.check_file(os.path.join(DATA, f"signals_ex{k}.json")); check(not probs, f"signals_ex{k}.json: {probs}")
        print(f"        {wid}: speed gaps {sum(x is None for x in spd)}, |Δv| median {dv:.2f} m/s, error range 0–{R} m")

# ---------------------------------------------------------------- kit widgets: five bars/1 (§3.4) with the registry cross-checks
def bars():
    ep = episodes(); el = ep[ep["eligible_main"]]
    cnt = el.groupby(["win", "fold"]).size()
    rows = [{"label": f"{wl} · {fl}", "v": int(cnt[(w, f)])} for w, wl in (("w01", "1 min"), ("w05", "5 min"), ("w15", "15 min"), ("full", "whole drive")) for f, fl in (("test", "test"), ("few_shot_heldout", "few-shot"))]
    check([r["v"] for r in rows] == [9299, 9671, 1917, 1963, 608, 565, 282, 460], f"bars_windows differ: {[r['v'] for r in rows]}")
    RECOMPUTED.update({"w01_test": 9299, "w01_fewshot": 9671, "w05_test": 1917, "w05_fewshot": 1963, "w15_test": 608, "w15_fewshot": 565, "full_test": 282, "full_fewshot": 460, "bench_episodes": int(len(el))})
    put("bars_windows", "bars_windows.json", {"schema": "bars/1", "unit": "", "dp": 0, "max": 10000, "rows": rows,
        "meta": {"source": "episode manifest v1: eligible windows per class and fold", "note": "map protocols drop 14 of the 5,795 test and few-shot 5-, 15-minute and whole-drive windows whose start has no drivable road within 400 m (few-shot 1,959 / 561 / 454)"}})
    # benchmark drives (distinct drives with an eligible episode)
    check(el.groupby(["driver", "drive"])["platform"].nunique().max() == 1, "platform differs within a drive")
    bd = el.drop_duplicates(["driver", "drive"])[["driver", "drive", "fold", "platform", "gps_source"]].reset_index(drop=True)
    RECOMPUTED.update({"bench_drives": len(bd), "bench_drivers": bd["driver"].nunique(), "platforms": bd["platform"].nunique(), "brands": bd["platform"].str.split("_").str[0].nunique(),
                       "bench_modem": int((bd["gps_source"] == "qcomdiag").sum()), "bench_ublox": int(bd["gps_source"].str.contains("ublox").sum())})
    for f, key in (("test", "test"), ("few_shot_heldout", "fewshot"), ("train", "train"), ("val", "val"), ("unassigned", "unassigned")):
        g = bd[bd["fold"] == f]; RECOMPUTED[f"{key}_drives"] = len(g); RECOMPUTED[f"{key}_drivers"] = g["driver"].nunique()
    RECOMPUTED["heldout_drives"] = RECOMPUTED["test_drives"] + RECOMPUTED["fewshot_drives"]; RECOMPUTED["heldout_drivers"] = RECOMPUTED["test_drivers"] + RECOMPUTED["fewshot_drivers"]
    full = ep[(ep["win"] == "full") & ep["eligible_main"] & (ep["set"] == "main")]
    RECOMPUTED["bench_hours"] = round(full["dur_s"].sum() / 3600); RECOMPUTED["bench_km"] = round(full["path_len_m"].sum() / 1000)
    # release manifest: scopes, receivers, rates, kept spans
    rm = release_manifest(); ok = rm[rm["status"] == "ok"]; main = ok[ok["set"] == "main"]; span_ok = ok["trim_hi_s"] - ok["trim_lo_s"]
    RECOMPUTED.update({"hf_drives": len(ok), "hf_drivers": ok["driver"].nunique(), "hf_hours": round(span_ok.sum() / 3600), "release_drives": len(main), "release_drivers": main["driver"].nunique(),
                       "release_hours": round((main["trim_hi_s"] - main["trim_lo_s"]).sum() / 3600), "controlled_drives": int((ok["set"] == "controlled").sum()),
                       "receivers_modem": int((ok["gps_sources"] == "qcomdiag").sum()), "receivers_ublox": int(ok["gps_sources"].str.contains("ublox").sum()),
                       "rate_10hz": int((ok["gps_rate_hz"] >= 8).sum()), "rate_1hz": int((ok["gps_rate_hz"] < 8).sum())})
    bm = bd.merge(ok[["driver", "drive", "trim_lo_s", "trim_hi_s"]], on=["driver", "drive"], how="left"); check(bm["trim_lo_s"].notna().all(), "benchmark drive missing from the release manifest")
    span_min = (bm["trim_hi_s"] - bm["trim_lo_s"]) / 60
    dur = [int(v) for v in pd.cut(span_min, [0, 5, 10, 20, 30, 60, 120, np.inf], right=True).value_counts(sort=False)]
    check(dur == [628, 685, 858, 562, 606, 238, 98] and sum(dur) == len(bd), f"duration bins differ: {dur}")
    med_kept = int(round((main["trim_hi_s"] - main["trim_lo_s"]).median())); check(med_kept == 880, f"median kept span {med_kept}")
    for k, v in zip(("dur_bin_0_5", "dur_bin_5_10", "dur_bin_10_20", "dur_bin_20_30", "dur_bin_30_60", "dur_bin_60_120", "dur_bin_120p"), dur): RECOMPUTED[k] = v
    RECOMPUTED["dur_median_kept_s"] = med_kept
    put("bars_durations", "bars_durations.json", {"schema": "bars/1", "unit": "drives", "dp": 0, "max": 900,
        "rows": [{"label": l, "v": v} for l, v in zip(("0–5 min", "5–10 min", "10–20 min", "20–30 min", "30–60 min", "1–2 h", "over 2 h"), dur)],
        "meta": {"source": "release manifest: kept span (trim_hi_s − trim_lo_s) of the 3,675 benchmark drives", "median_kept_s": med_kept}})
    per = bd.groupby("driver").size()
    dpd = [int(v) for v in pd.cut(per, [0, 1, 2, 5, 10, 20, 50, np.inf], right=True).value_counts(sort=False)]
    check(dpd == [134, 78, 111, 49, 25, 23, 11] and int(per.median()) == 3 and int(per.max()) == 303, f"drives-per-driver bins differ: {dpd}, median {per.median()}, max {per.max()}")
    for k, v in zip(("dpd_1", "dpd_2", "dpd_3_5", "dpd_6_10", "dpd_11_20", "dpd_21_50", "dpd_50p"), dpd): RECOMPUTED[k] = v
    RECOMPUTED["dpd_median"] = int(per.median()); RECOMPUTED["dpd_max"] = int(per.max())
    put("bars_drivers", "bars_drivers.json", {"schema": "bars/1", "unit": "drivers", "dp": 0, "max": 150,
        "rows": [{"label": l, "v": v} for l, v in zip(("1 drive", "2 drives", "3–5", "6–10", "11–20", "21–50", "more than 50"), dpd)],
        "meta": {"source": f"benchmark drives per driver, {len(per)} drivers", "median": int(per.median()), "max": int(per.max())}})
    tok = bd["platform"].str.split("_").str[0]; counts = tok.value_counts()
    top = [("HONDA", "Honda", "brand_honda"), ("HYUNDAI", "Hyundai", "brand_hyundai"), ("RIVIAN", "Rivian", "brand_rivian"), ("CHEVROLET", "Chevrolet", "brand_chevrolet"), ("FORD", "Ford", "brand_ford"),
           ("ACURA", "Acura", "brand_acura"), ("KIA", "Kia", "brand_kia"), ("TOYOTA", "Toyota", "brand_toyota"), ("TESLA", "Tesla", "brand_tesla"), ("VOLKSWAGEN", "Volkswagen", "brand_vw")]
    check(list(counts.index[:10]) == [t[0] for t in top], f"brand ranking differs: {list(counts.index[:10])}")
    brow = [{"label": lab, "v": int(counts[t])} for t, lab, _ in top]; other = int(len(bd) - sum(r["v"] for r in brow)); n_other = int(len(counts) - 10)
    check([r["v"] for r in brow] == [595, 575, 421, 338, 324, 321, 260, 216, 205, 161] and other == 259 and n_other == 17, f"brand counts differ: {[r['v'] for r in brow]} other {other} ({n_other} brands)")
    for (_, _, key), r in zip(top, brow): RECOMPUTED[key] = r["v"]
    RECOMPUTED["brand_other"] = other
    put("bars_brands", "bars_brands.json", {"schema": "bars/1", "unit": "drives", "dp": 0, "max": 600, "rows": brow + [{"label": f"{n_other} other brands", "v": other, "color": "mute"}],
        "meta": {"source": f"first token of platform over the {len(bd):,} benchmark drives; {len(counts)} brands, {bd['platform'].nunique()} platforms"}})
    cf = pd.read_csv(os.path.join(TABLES, "common_failure_strata_w05.csv")); turns = cf[cf["stratum"] == "reference turns"].set_index("level")
    labels = (("0-1", "0–1 turns"), ("2-3", "2–3 turns"), ("4-6", "4–6 turns"), ("7+", "7+ turns"))   # short: the kit Bars label column is 150 px and the note carries the window count
    crow = [{"label": lab, "v": num(100 * turns.loc[lv, "all_fail_share"], 2), "note": f"n = {int(turns.loc[lv, 'n']):,}"} for lv, lab in labels]   # "n = 2,234": label and note share the kit's 150 px column
    ci = {lv: [num(100 * turns.loc[lv, "all_fail_lo"], 2), num(100 * turns.loc[lv, "all_fail_hi"], 2)] for lv, _ in labels}
    check([r["v"] for r in crow] == [0.09, 1.4, 5.3, 8.71] and [r["note"] for r in crow] == ["n = 2,234", "n = 712", "n = 528", "n = 402"], f"common failure values differ: {crow}")
    check(ci == {"0-1": [0.0, 0.23], "2-3": [0.57, 2.87], "4-6": [3.26, 8.66], "7+": [5.29, 12.44]}, f"common failure CIs differ: {ci}")
    put("bars_common_failure", "bars_common_failure.json", {"schema": "bars/1", "unit": "%", "dp": 2, "max": 10, "rows": crow,
        "meta": {"source": "common_failure_strata_w05.csv: share of five-minute windows no map method recovers, test and few-shot pooled", "ci": ci}})
    # map-start exclusions (registry cross-check only)
    mp = pd.read_parquet(os.path.join(HF, "benchmark", "manifests", "episode_map_v11.parquet"), columns=["fold", "win", "map_start_ok", "start_edge_dist_m"])
    pool = mp[mp["fold"].isin(["test", "few_shot_heldout"]) & mp["win"].isin(["w05", "w15", "full"])]
    RECOMPUTED.update({"map_start_pool": len(pool), "map_start_excluded": int((~pool["map_start_ok"]).sum()), "map_start_dist_med": round(float(mp["start_edge_dist_m"].median()), 1)})

# ---------------------------------------------------------------- kit Paired: paired_complementarity (§3.4, V15a)
def paired():
    c = pd.read_csv(os.path.join(TABLES, "complementarity_w05.csv")); mem = pd.read_csv(os.path.join(TABLES, "complementarity_members_w05.csv"))
    SETS = {"A": "A steering map, heading known", "B": "B speed-only map, heading known", "Bp": "B' speed-only map, heading unknown", "D": "D all map, heading known"}
    def row(s, fold):
        r = c[(c["set"] == SETS[s]) & (c["fold"] == fold)]; check(len(r) == 1, f"complementarity row {s}/{fold}"); return r.iloc[0]
    LAB = {"A": "A · steering map methods (6)", "B": "B · speed-only map methods (4)", "Bp": "B′ · speed only, no heading (4)", "D": "D · all ten map methods"}   # ≤ 31 characters: the kit's label column is 180 units of a 700-unit viewBox
    groups = []
    for fold, fl in (("test", "test drivers"), ("few_shot_heldout", "few-shot drivers")):
        D = row("D", fold); n, nd = int(D["n"]), int(D["n_drivers"])
        rows = [{"id": s, "label": LAB[s], "a": num(row(s, fold)["ref_route"], 3), "b": num(row(s, fold)["oracle_route"], 3), **({"emph": True} if s in ("A", "D") else {})} for s in ("A", "B", "Bp", "D")]
        pct = lambda v: f"{100 * v:.1f}"
        note = (f"Set D (all ten map methods with the start heading): the oracle recovers {pct(D['oracle_route'])} % of windows against the beam's {pct(D['ref_route'])} %; "
                f"no method recovers {pct(D['all_fail_share'])} % [{pct(D['all_fail_lo'])}, {pct(D['all_fail_hi'])}] of them. A diagnostic, not a deployable selector. Sets A, B and D know the start heading, B′ does not; B and B′ are measured against the speed-only beam." if fold == "test" else
                f"Set D on the few-shot drivers: oracle {pct(D['oracle_route'])} % against the beam's {pct(D['ref_route'])} %; no method recovers {pct(D['all_fail_share'])} % [{pct(D['all_fail_lo'])}, {pct(D['all_fail_hi'])}] of windows. Sets A, B and D know the start heading, B′ does not; B and B′ are measured against the speed-only beam.")
        groups.append({"id": fold, "label": f"{fl} · {n:,} windows · {nd} drivers", "n": n, "delta": num(D["route_gain"], 3), "ci": [num(D["route_gain_lo"], 3), num(D["route_gain_hi"], 3)], "note": note, "rows": rows})
    g0, g1 = groups
    def near(rows, exp): return all(abs(r["a"] - a) <= 0.0011 and abs(r["b"] - b) <= 0.0011 for r, (a, b) in zip(rows, exp))   # §3.4 lists B′ test as .325; the CSV value .324465 rounds to .324
    check(near(g0["rows"], [(0.876, 0.969), (0.537, 0.777), (0.325, 0.716), (0.876, 0.977)]) and g0["delta"] == 0.101 and g0["ci"] == [0.055, 0.157] and g0["n"] == 1917, f"paired test group differs: {g0}")
    check(near(g1["rows"], [(0.919, 0.981), (0.468, 0.772), (0.286, 0.699), (0.919, 0.984)]) and g1["delta"] == 0.065 and g1["ci"] == [0.044, 0.097] and g1["n"] == 1959, f"paired few-shot group differs: {g1}")
    check("97.7 % of windows against the beam's 87.6 %; no method recovers 2.3 % [1.4, 3.6]" in g0["note"] and "oracle 98.4 % against the beam's 91.9 %; no method recovers 1.6 % [0.9, 2.5]" in g1["note"], "paired notes differ from §3.4")
    members = {("B′" if s == "Bp" else s): row(s, "test")["members"] for s in ("A", "B", "Bp", "D")}
    md = mem[(mem["set"] == SETS["D"]) & (mem["fold"] == "test")].sort_values("share_attains_oracle", ascending=False)
    attains = {str(r["member"]): num(r["share_attains_oracle"], 3) for _, r in md.iterrows()}
    check(attains == {"opd2": 0.22, "lineage": 0.218, "beam": 0.191, "macro": 0.11, "ep_hp": 0.094, "dewri_hp": 0.091, "pf": 0.04, "beam_none": 0.022, "pf_none": 0.01, "spy_hp": 0.004}, f"attains-oracle shares differ: {attains}")
    put("paired_complementarity", "paired_complementarity.json", {"schema": "paired/1", "mode": "dumbbell", "axis": {"min": 0.2, "max": 1.0, "label": "route recovered · share of five-minute windows"},
        "from": "the beam (fixed reference)", "to": "per-window oracle over the set", "groups": groups,
        "meta": {"source": "complementarity_w05.csv (ref_route, oracle_route, route_gain); members per set in complementarity_members_w05.csv", "members": members, "attains_oracle_test": attains}})

# ---------------------------------------------------------------- media (§3.11) and manifest items (§3.7)
MEDIA_FILES = [  # (file in WORK/media = file in static/media, bytes, manifest key)
    ("anim_overview_clean.mp4", 434384, "media_anim_overview"), ("anim_overview.jpg", 57042, "poster_anim_overview"),
    ("anim_replay_clean.mp4", 550865, "media_anim_replay"), ("anim_replay.jpg", 47332, "poster_anim_replay"),
    ("ex1.mp4", 1161903, "media_ex1"), ("ex2.mp4", 302212, "media_ex2"), ("ex3.mp4", 1112671, "media_ex3"), ("ex4.mp4", 960693, "media_ex4"), ("ex5.mp4", 735923, "media_ex5"), ("ex6.mp4", 773826, "media_ex6"),
    ("ex1.jpg", 26916, "poster_ex1"), ("ex2.jpg", 12102, "poster_ex2"), ("ex3.jpg", 25267, "poster_ex3"), ("ex4.jpg", 13559, "poster_ex4"), ("ex5.jpg", 16356, "poster_ex5"), ("ex6.jpg", 13095, "poster_ex6"),
    ("fig_method.png", 219271, "fig_method"), ("fig_method@2x.jpg", 337307, "fig_method_2x"), ("fig_examples_w05.png", 300679, "fig_examples_w05"), ("fig_examples_w05@2x.jpg", 318729, "fig_examples_w05_2x"),
    ("fig_cdf_w05.png", 108917, "fig_cdf_w05"), ("fig_horizon_cohort.png", 99798, "fig_horizon_cohort"), ("fig_robust_w05.png", 34381, "fig_robust_w05"), ("fig_topk_w05.png", 56723, "fig_topk_w05")]
TOTAL_MEDIA = 7_719_951   # ex3.mp4, ex5.mp4 and ex5.jpg carry the QA blurs (see BLUR_NOTES); copy the blurred files into WORK/media before re-running
BLUR_NOTES = {"ex3": "; the oncoming vehicle's plate region (lower left) is blurred 3.9–4.7 s as a precaution: a motion smear at this resolution, no character legible",
              "ex5": "; the roadside guide-sign band (right shoulder) is blurred 12.2–14.8 s and in the poster as a precaution: its text does not resolve at this resolution"}
def privacy(kind, source_pixels, note): return {"kind": kind, "source_pixels": source_pixels, "manual_review": "ok", "reviewed_by": REVIEWER, "reviewed_at": TODAY, "note": note}

def media(TR):
    MI = media_index(); led = {it["file"]: it for it in MI["items"]}
    names = {f for f, _, _ in MEDIA_FILES}; extra = sorted(set(os.listdir(MEDIA)) - names)
    check(not extra, f"unexpected files in static/media (never deleted by this script): {extra}")
    for f, nbytes, key in MEDIA_FILES:
        src, dst = os.path.join(WORK, "media", f), os.path.join(MEDIA, f)
        check(os.path.exists(src) and os.path.getsize(src) == nbytes, f"{f}: missing in the work folder or {os.path.getsize(src) if os.path.exists(src) else 0:,} B ≠ {nbytes:,} B (§3.11)")
        if not os.path.exists(dst) or sha256_file(src) != sha256_file(dst): shutil.copyfile(src, dst); print(f"  media copied {f}")
        check(os.path.getsize(dst) == nbytes, f"{f}: copy size differs")
        if f.endswith(".mp4"):
            pr = ffprobe(dst); l = led[f]
            check(pr["codec"] == "h264" and pr["pix_fmt"] == "yuv420p" and pr["width"] % 2 == 0 and pr["height"] % 2 == 0, f"{f}: {pr}")
            check(pr["bytes"] <= CAPS["video_bytes"] and open(dst, "rb").read(64 << 10).find(b"moov") >= 0, f"{f}: cap or faststart")
            check(abs(pr["duration"] - float(l["duration_s"])) < 0.1 and pr["width"] == l["width"] and pr["height"] == l["height"], f"{f}: ffprobe {pr} vs ledger {l}")
            led[f]["probe"] = pr
        elif f.endswith(".jpg"): check(os.path.getsize(dst) <= (CAPS["poster_bytes"] if ("poster" in f or "lqip" in f) else CAPS["figure_bytes"]), f"{f}: over the jpg cap")
        files[key] = media_entry(f)
    total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*"))); check(total == TOTAL_MEDIA and total < CAPS["total_media_bytes"], f"media total {total:,} B ≠ {TOTAL_MEDIA:,} B")
    for k in range(1, 7):
        wid = f"ex{k}"; l = led[f"{wid}.mp4"]; pr = l["probe"]; mp4, jpg = os.path.join(MEDIA, f"{wid}.mp4"), os.path.join(MEDIA, f"{wid}.jpg")
        check(l["episode_id"] == TR[wid]["episode_id"] and l["frame_t_clip_s"] == 12.0, f"{wid}: ledger episode/frame")
        items[wid] = {"id": wid, "kind": "clip", "title": f"{TR[wid]['label']} · {TR[wid]['episode_id']}",
                      "files": {"video": f"static/media/{wid}.mp4", "poster": f"static/media/{wid}.jpg", "signals": f"static/data/signals_ex{k}.json", "traj": f"static/data/traj_ex{k}.json"},
                      "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": wid == "ex4", "duration_s": num(l["duration_s"], 2),
                      "key_moment": {"t": 12.0, "label": "mid-window camera frame"}, "poster_lqip": MI["lqip"][wid],
                      "privacy": privacy("road", True, "released forward-camera segment, 640×402, 24 s around the mid-window frame; pseudonymous driver; no faces or legible plates seen in the posters, full clip reviewed by the user" + BLUR_NOTES.get(wid, "")),
                      "provenance": {"source": "released one-minute camera segments (hf_staging_video)", "video": {"codec": pr["codec"], "fps": pr["fps"], "crf": 26}}, "entry_hash": entry_hash({"id": wid}, mp4, jpg)}
    for stem, dur, title, tposter in (("anim_overview", 14.0, "Released GNSS tracks drawn in from west to east, with a running counter (an earlier snapshot of the release)", 13.5),
                                      ("anim_replay", 20.0, "One drive replayed at 10 Hz: trail by GPS speed, GPS speed against CAN speed, altitude", 10.0)):
        mp4, jpg = os.path.join(MEDIA, f"{stem}_clean.mp4"), os.path.join(MEDIA, f"{stem}.jpg"); pr = led[f"{stem}_clean.mp4"]["probe"]; check(abs(pr["duration"] - dur) < 0.1, f"{stem}: duration {pr['duration']}")
        items[stem] = {"id": stem, "kind": "clip", "title": title, "files": {"video": f"static/media/{stem}_clean.mp4", "poster": f"static/media/{stem}.jpg"},
                       "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": False, "duration_s": dur, "key_moment": {"t": tposter, "label": "poster frame"}, "poster_lqip": MI["lqip"][stem],
                       "privacy": privacy("figure", False, "track animation rendered from GNSS positions for the dataset card; no camera pixels, no basemap tiles, no labels or ticks; burnt-in text boxes masked"),
                       "provenance": {"source": "dataset-card track animations, masked re-encode", "video": {"codec": pr["codec"], "fps": pr["fps"], "crf": 22}}, "entry_hash": entry_hash({"id": stem}, mp4, jpg)}
    for stem, two_x, src_px, title in (("fig_method", True, True, "Pipeline on one five-minute window: inputs, visible roads, candidate paths, scoring"),
                                       ("fig_examples_w05", True, True, "Six recovered five-minute windows below their mid-window camera frames"),
                                       ("fig_cdf_w05", False, False, "Distribution of the five-minute error on the test drivers, three panels"),
                                       ("fig_horizon_cohort", False, False, "The same test drives scored 1, 5 and 15 minutes after the start"),
                                       ("fig_robust_w05", False, False, "Degraded-input robustness sweep: change in route recovery"),
                                       ("fig_topk_w05", False, False, "Lowest-error path among the K highest-ranked candidate paths")):
        png = os.path.join(MEDIA, f"{stem}.png"); srcs = [png] + ([os.path.join(MEDIA, f"{stem}@2x.jpg")] if two_x else [])
        fl = {"image": f"static/media/{stem}.png"}
        if two_x: fl["image_2x"] = f"static/media/{stem}@2x.jpg"
        items[stem] = {"id": stem, "kind": "figure", "title": title, "files": fl, "bytes": {"image": os.path.getsize(png)}, "first_view": False,
                       "privacy": privacy("figure", src_px, "paper figure with released forward-camera frames" if src_px else "paper figure drawn from the benchmark tables; no camera pixels, no map tiles"),
                       "provenance": {"source": f"paper figure {stem}.pdf rendered at 200 dpi (1x) and 400 dpi (2x)" if two_x else f"paper figure {stem}.pdf rendered at 200 dpi"}, "entry_hash": entry_hash({"id": stem}, *srcs)}
    print(f"  media: {len(MEDIA_FILES)} files, {total:,} B; {len(items)} items")

# ---------------------------------------------------------------- sources (§3.5), numbers (§3.6), manifest + SHA256SUMS (§3.7, §3.8)
HF_URL = "https://huggingface.co/datasets/HenryYHW/CANTraj"; GH_TREE = "https://github.com/WangYuHang-cmd/GPS--CAN/tree/266c4af"; GH_SUPP = "https://github.com/WangYuHang-cmd/GPS--CAN/blob/main/supplementary/supplementary.pdf"
def hf(i, loc, q): return {"id": i, "kind": "hf-card", "url": HF_URL, "date": TODAY, "locator": loc, "quote": q}
def gh(i, loc, q, url=GH_TREE): return {"id": i, "kind": "github", "url": url, "date": TODAY, "locator": loc, "quote": q}
def lg(i, loc, q): return {"id": i, "kind": "log", "url": None, "date": TODAY, "locator": loc, "quote": q}
SOURCES = [
    hf("hf-card", "dataset card", "98,972 eligible episodes from 3,675 drives and 431 drivers"),
    hf("hf-card-release", "dataset card · release size", "3,988 drives, 468 drivers, 1,665 hours of trimmed GPS track"),
    hf("hf-card-receivers", "dataset card · receivers", "990 were logged by a u-blox receiver and 2,998 by a Qualcomm modem receiver"),
    hf("hf-card-rates", "dataset card · rates", "432 tracks are at 10 Hz and 3,556 at about 1 Hz"),
    hf("hf-card-protocols", "dataset card · protocols", "Eight protocols = {online, offline} x {no map, OpenStreetMap road graph}"),
    hf("hf-card-methods", "dataset card · methods", "re-implementations of six published methods"),
    hf("hf-card-license", "dataset card · access", "gated, research use only, under the DriveDNA research license; approval is manual"),
    hf("hf-card-windows", "dataset card · benchmark", "1,917 / 1,963 windows"),
    hf("hf-card-mapstart", "dataset card · map protocols", "14 of the 5,795 test and few-shot episodes of 5 and 15 minutes"),
    hf("hf-card-w15", "dataset card · results", "On 15-minute windows the beam search's median ADE is 149 / 106 m"),
    hf("hf-card-version", "dataset card · changelog", "version 1.1 (2026-10-28) changes the maps and the failure accounting"),
    hf("hf-card-privacy", "dataset card · privacy", "the origin and the destination of a trip are not in the data"),
    hf("hf-card-files", "dataset card · files", "5,801 CSV files, 4.46 GB in total"),
    hf("hf-card-tiles", "dataset card · maps", "149 of them had been cut incompletely"),
    hf("hf-card-disc", "dataset card · visible disc", "5 km + 40 m/s x window length around the start, at most 60 km"),
    hf("hf-card-eligibility", "dataset card · eligibility", "at least 80% of seconds with a fix, no gap over 30 s, path over 100 m"),
    gh("gh-readme", "README.md @266c4af", "Research use only, see `LICENSE` (DriveDNA Research License)."),
    gh("gh-models", "README.md @266c4af · trained weights", "24 models, 73 files, 3.3 MB"),
    gh("gh-supp", "supplementary.pdf S1", "3,940 drives of 454 drivers", GH_SUPP),
    gh("gh-supp-eval", "supplementary.pdf S2", "776 evaluation drives of 94 drivers", GH_SUPP),
    gh("gh-supp-pf", "supplementary.pdf S3 · filter settings", "2,000 particles, 10 Hz ticks", GH_SUPP),
    gh("gh-supp-sample", "supplementary.pdf S3 · re-implementation checks", "8 of 59 logs within a median of at most 0.33 m", GH_SUPP),
    gh("gh-main-board", "main_board.csv (benchmark report tables)", "map_beam_steer__G3,F-M-Hp,w05,test,1917.0,1917.0,0.0,0.0,42.0,36.53811728851419"),
    gh("gh-pairs", "pairs.csv (paired comparisons on common windows)", "map gain, steering, heading known"),
    gh("gh-cohort", "cohort_horizon.csv (205 test drives scored at 1, 5 and 15 min)", "map_beam_steer__G3,F-M-Hp,test,60"),
    gh("gh-robust", "robustness_w05.csv and the map-attack sweep (supplementary table)", "steering quantised to 20 deg"),
    gh("gh-topk", "topk_w05.csv", "map_beam_none__G1,F-M-Hm,test,1917,1917,2,1314.19"),
    gh("gh-signal-gains", "signal_gains_w05.csv", "map,steering | speed,S3,S1,1,407,31,-233.7"),
    gh("gh-signal-sets", "signal_sets_w05.csv", "map,S3,0,407,0,48.4"),
    gh("gh-cost", "cost.csv (single-worker inference time per window)", "map_beam_steer,1.75529"),
    gh("gh-cost-acc", "cost_accuracy.csv", "map_beam_steer__G3,F-M-Hp,w05,76,0,21.08"),
    gh("gh-agent", "agent_w05.csv", "beam,test,map beam (A),268,42,69.40"),
    gh("gh-agent-max", "agent_max_w05.csv (extended configuration)", 'agent,test,"Qwen agent (C), seeds pooled",268,42'),
    gh("gh-agent-pairs", "agent_pairs_w05.csv and agent_max_pairs_w05.csv", "agent_vs_selector,test,268,42,0.124"),
    gh("gh-methods", "methods.csv (17 method rows)", "Hold start,baseline,none"),
    gh("gh-visibility", "a3_visibility.csv (map visibility re-run)", "share_abs_diff_lt_1m"),
    lg("log-manifest", "recomputed from the released manifests: episode manifest v1 (eligible episodes, folds, platforms, hours, km), release manifest (kept spans, receivers), map manifest v1.1", "3,675 drives · 431 drivers · 266 platforms · 1,380 h · 85,919 km · 98,972 episodes"),
    lg("log-tables", "benchmark v1.1 report tables shipped with the release package (per-episode scores and derived tables)", "window taxonomy, complementarity, density strata, confidence, driver spread, supplement summary"),
    lg("log-media", "page media: six released one-minute camera segments cut to 24 s around the mid-window frame; two track animations re-encoded from the dataset-card renders", "24 s clips · 14 s and 20 s animations")]
def sources():
    check(len({s["id"] for s in SOURCES}) == len(SOURCES) and all(len(s["quote"]) <= 120 for s in SOURCES), "sources: duplicate id or quote > 120 chars")
    put("sources", "sources.json", {"schema": "sources/1", "sources": SOURCES})

def numbers():
    reg, on = {}, False
    for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
        if line.startswith("cantraj:"): on = True; continue
        if not line.startswith(" ") and line.strip(): on = False
        if on and line.strip() and not line.strip().startswith("#"):
            k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
            if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
    check(len(reg) >= 300, f"registry block cantraj: has {len(reg)} entries (expected ≥ 300); append the §3.9 block first")
    diff = [(k, v, reg[k]["value"] if k in reg else None) for k, v in RECOMPUTED.items() if k not in reg or abs(reg[k]["value"] - float(v)) > 1e-6]
    if diff:
        for k, mine, theirs in diff: print(f"  registry {k:22s} recomputed {mine}  registry {theirs}")
        fail(f"{len(diff)} recomputed value(s) differ from the registry block")
    print(f"  registry: {len(reg)} entries, {len(RECOMPUTED)} recomputed values agree")
    put("numbers", "numbers.json", {"schema": "numbers/1", "page": "cantraj", "numbers": reg})

def manifest():
    expected = [k for g in ("traj", "signals", "charts", "bars", "paired", "sources") for k in GROUPS[g]] + ["numbers"]
    missing = [k for k in expected if k not in files]; check(not missing, f"data files not exported: {missing}")
    stray = sorted(set(os.listdir(DATA)) - {os.path.basename(f["path"]) for f in files.values()} - {"manifest.json"}); check(not stray, f"unregistered files in static/data (remove them by hand): {stray}")
    first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"].get("poster", 0) + it["bytes"].get("image", 0) for it in items.values() if it.get("first_view"))
    total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*"))); check(total == TOTAL_MEDIA, f"media total {total:,} B")
    mpath = os.path.join(DATA, "manifest.json")
    its = carry_review(list(items.values()), mpath); bad = [it["id"] for it in its if it["privacy"]["manual_review"] != "ok"]; check(not bad, f"items not ok: {bad}")
    man = {"schema": "manifest/1", "page": "cantraj", "generated": TODAY, "pipeline_version": "1",
           "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
           "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": its}
    n, h = write_json(mpath, man); m = BAD.search(open(mpath, encoding="utf8").read()); check(not m, f"manifest: forbidden string {m.group(0) if m else ''}")
    print(f"manifest: {len(files)} files · {len(its)} items · media {total:,} B ({total/1e6:.2f} MB of {CAPS['total_media_bytes']/1e6:.0f}) · first view {first:,} B ({first/1e6:.3f} MB of {CAPS['first_view_bytes']/1e6:.0f}) · {n/1024:.1f} KB")
    with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
        for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
    print("  SHA256SUMS written")

# ---------------------------------------------------------------- thumbnail images/th_cantraj.jpg (§3.12): the ex4 window drawn with PIL
def thumbnail():
    from PIL import Image, ImageDraw
    o = json.load(open(os.path.join(DATA, "traj_ex4.json"))); c = o["cols"]; x0, x1, y0, y1 = o["meta"]["box_m"]
    S = 4; W, H = 620 * S, 388 * S; pad = 0.06
    s = min(W * (1 - 2 * pad) / (x1 - x0), H * (1 - 2 * pad) / (y1 - y0)); ox = (W - (x1 - x0) * s) / 2; oy = (H - (y1 - y0) * s) / 2
    P = lambda x, y: (ox + (x - x0) * s, oy + (y1 - y) * s)
    def poly(pts): return [P(x, y) for x, y in pts if x is not None and y is not None]
    def runs(xs, ys):   # consecutive stretches without nulls
        out, cur = [], []
        for x, y in zip(xs, ys):
            if x is None or y is None:
                if len(cur) > 1: out.append(cur)
                cur = []
            else: cur.append((x, y))
        if len(cur) > 1: out.append(cur)
        return out
    def dashed(pts, on, off):
        segs, state, left, cur = [], True, on, [pts[0]]
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            L = math.hypot(bx - ax, by - ay); pos = 0.0
            while L - pos > left:
                pos += left; q = (ax + (bx - ax) * pos / L, ay + (by - ay) * pos / L)
                if state: cur.append(q); segs.append(cur)
                cur = [q]; state = not state; left = on if state else off
            left -= (L - pos)
            if state: cur.append((bx, by))
            else: cur = [(bx, by)]
        if state and len(cur) > 1: segs.append(cur)
        return segs
    im = Image.new("RGB", (W, H), "#070d1d")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for r in o["roads"]:
        q = poly(r)
        if len(q) > 1: d.line(q, fill=(159, 178, 214, 89), width=int(1.5 * S), joint="curve")
    im = Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB")
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for cand in o["candidates"]:
        for run in runs(cand["x"], cand["y"]): d.line(poly(run), fill=(217, 89, 38, 64), width=int(1.5 * S), joint="curve")
    im = Image.alpha_composite(im.convert("RGBA"), layer).convert("RGB"); d = ImageDraw.Draw(im)
    d.line(poly(list(zip(c["ref_x"], c["ref_y"]))), fill="#e8eefc", width=3 * S, joint="curve")
    for run in runs(c["beam_x"], c["beam_y"]):
        for seg in dashed(poly(run), 7 * S, 4 * S): d.line(seg, fill="#d95926", width=2 * S, joint="curve")
    for run in runs(c["filter_x"], c["filter_y"]): d.line(poly(run), fill="#d95926", width=2 * S, joint="curve")
    sx, sy = P(0, 0); r0, ring = 3 * S, 2 * S
    d.ellipse([sx - r0 - ring, sy - r0 - ring, sx + r0 + ring, sy + r0 + ring], fill="#070d1d"); d.ellipse([sx - r0, sy - r0, sx + r0, sy + r0], fill="#ffffff")
    bar = 500 * s; bx1, by = W - 10 * S, H - 10 * S; d.line([(bx1 - bar, by), (bx1, by)], fill="#9fb2d6", width=2 * S)
    im = im.resize((620, 388), Image.LANCZOS)
    dst = os.path.join(REPO, "images", "th_cantraj.jpg"); q = 82
    while True:
        im.save(dst, "JPEG", quality=q, optimize=True, progressive=True)
        if os.path.getsize(dst) <= 60_000 or q <= 40: break
        q -= 6
    chk = Image.open(dst); check(chk.size == (620, 388) and chk.mode == "RGB" and chk.info.get("progressive") == 1 and os.path.getsize(dst) <= 60_000, f"thumbnail {chk.size} {chk.mode} {os.path.getsize(dst)} B")
    print(f"  thumbnail images/th_cantraj.jpg {os.path.getsize(dst):,} B, quality {q}, scale {s/S:.4f} px/m")

# ---------------------------------------------------------------- run, in the order of §3.13
print(f"cantraj export · repo {os.path.relpath(REPO, os.getcwd()) or '.'} · {TODAY}")
TR = traj() if want("traj") else (skip_group("traj") or load_traj_from_disk())
if want("signals"): signals(TR)
else: skip_group("signals")
if want("charts"):
    if A.skip_cdf: os.environ["CANTRAJ_SKIP_CDF"] = "1"
    kw = {}
    try:
        params = inspect.signature(CD.export_all).parameters
        if "skip_cdf" in params: kw["skip_cdf"] = A.skip_cdf
        elif "skip" in params: kw["skip"] = ["cdf"] if A.skip_cdf else []
    except (TypeError, ValueError): pass
    CD.export_all(put, **kw)
    for k in CD.KEYS:
        if k not in files: register_existing(k, k + ".json", False)
else: skip_group("charts")
bars()                                   # always: cheap, and numbers() cross-checks the registry block against its recomputed values
if want("paired"): paired()
else: skip_group("paired")
media(TR)                                # always: the manifest items and the media checks come from this step (cheap when nothing changed)
if want("sources"): sources()
else: skip_group("sources")
numbers()
manifest()
if want("thumbnail"): thumbnail()
print("done")
