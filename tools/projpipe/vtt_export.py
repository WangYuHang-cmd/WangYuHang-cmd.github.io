#!/usr/bin/env python3
"""VTT page exports — LOCAL. Inputs: the VTT build (10 Hz drive tables + indices under $VTT_DATA_ROOT/build), the saved test probabilities
(experiments/results/*_probs.npz), the demo figures / animation (VehicleTypeTraj/demo) and the paper figures. Forward-camera clips are cut through
demo/vizlib.cut_clip, so the private drive -> raw clip mapping never enters this script (nor any output or log). Needs the VTT conda interpreter:
    source ~/Desktop/Drive/VehicleTypeTraj/env.sh && cd tools/projpipe && $CPY vtt_export.py [--force]
Outputs vtt/static/{data,media}, manifest.json, sources.json, numbers.json (from registry.yaml "vtt:") and static/SHA256SUMS."""
import argparse, glob, json, os, re, sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, nums, edges, h264, fit_cap, poster, lqip, jpeg_fit, ffprobe, sha256_file, entry_hash, Ledger
VTT = os.environ.get("VTT_REPO", os.path.join(PATHS["drive"], "VehicleTypeTraj")); sys.path.insert(0, VTT); sys.path.insert(0, os.path.join(VTT, "demo"))
import vizlib as V                                   # noqa: E402  (public helpers only; the private clip mapping stays inside)
from experiments import episodes as E                # noqa: E402  (the project's own episode detector: lift-off / brake decelerations, stops, launches, turns)
REPO = PATHS["repo"]; PAGE = os.path.join(REPO, "vtt"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media")
WORK = os.path.join(PATHS["work"], "vtt"); DEMO = os.path.join(VTT, "demo"); PFIG = os.path.join(VTT, "paper", "figures"); VIZLIB = os.path.join(DEMO, "vizlib.py")
for d in (DATA, MEDIA, WORK): os.makedirs(d, exist_ok=True)
HFURL = "https://huggingface.co/datasets/HenryYHW/Vehicle_Power_Type_Trajectory_Dataset"; GHURL = "https://github.com/WangYuHang-cmd/-Vehicle_Power_Type_Trajectory_Dataset"; GHBLOB = GHURL + "/blob/main/"; TODAY = "2026-11-09"
HZ = 10.0; CASE_CAP = 1_600_000                      # per case clip (7 clips + animation + 15 figures must stay under the 25 MB page budget)
PBEV = "split_platform__bev_ice__resnet__B5__s1"     # window P(BEV) drawn on every clip (the demo figures use the same run)
PSIZE = "split_platform__size__gru__S9__s0"          # window P(size) drawn on cases 5-6
RES_B5 = V.seed_tags("split_platform__bev_ice__resnet__B5"); GRU_S9 = V.seed_tags("split_platform__size__gru__S9")
REF_RES = V.seed_tags("split_platform__bev_ice__resnet"); REF_GRU = V.seed_tags("split_platform__size__gru")
EMPH = ["Tesla Model Y", "Toyota Corolla", "Tesla Model S", "Ford F-150 Lightning", "Hyundai Kona", "Genesis G90", "Kia Stinger"]
ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); A = ap.parse_args()
files, items = {}, {}; ledger = Ledger(os.path.join(WORK, "ledger.jsonl")).load()
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:26s} {n/1024:7.1f} KB")
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}
def table_path(drive_id): return os.path.join(V.BUILD, V.drive_info(drive_id)["file"])
PRIV_ROAD = lambda note: {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": note}

# ---------------------------------------------------------------- helpers: signals of a drive-time span, episodes, window series, decisions, clips
LAB = {"v_ego_mps": "speed", "a_mps2": "acceleration", "gas_pressed": "accelerator pedal", "brake_pressed": "brake pedal", "das_any": "automation activity", "lead_d_m": "lead distance", "steer_angle_deg": "steering angle", "yaw_rate_degps": "yaw rate"}
UNI = {"v_ego_mps": "m/s", "a_mps2": "m/s²", "lead_d_m": "m", "steer_angle_deg": "deg", "yaw_rate_degps": "deg/s"}
EV = {"DEC_LIFT": ("liftoff", "lift-off deceleration, brake not pressed", "↓"), "DEC_BRK": ("brake", "brake-pedal deceleration", "▼"), "STOP": ("stop", "stop", "■"), "LAUNCH": ("launch", "launch from standstill", "▶"), "TURN": ("turn", "turn", "↰")}
_EP = {}
def episodes(drive_id):
    """Episodes of a drive from experiments/episodes.py (drive seconds; onset = anchor row), cached per drive."""
    if drive_id not in _EP:
        arr = E.load_drive_arrays(table_path(drive_id)); t = V.load_drive(drive_id)["t_s"].to_numpy(); rows = []
        for ep in E.detect_episodes(arr):
            fl = E.episode_flags(arr, ep)
            rows.append(dict(type=ep.type, t_on=float(t[ep.anchor_row]), t0=float(t[ep.i0]), t1=float(t[ep.i1 - 1]) + 1 / HZ, dur_s=float(ep.dur_s), dv=float(ep.dv), mean_a=float(ep.mean_a), peak_a=float(ep.peak_a),
                             das_any_frac=float(fl["das_any_frac"]), brake_frac=float(arr["brake_pressed"][ep.i0:ep.i1].mean()), human_strict=bool(fl["human_strict"])))
        _EP[drive_id] = pd.DataFrame(rows)
    return _EP[drive_id]
def span_signals(drive_id, a, b, clip_id, extra=(), t_off=0.0):
    """signals/1 of drive time [a, b): the drive-table rows on the nominal 10 Hz clock. t runs from t_off (0 = clip time; t_off = a gives drive time, which a synced
    whole-drive timeline needs — the kit maps video time 0 to t0 either way). The case drives have no gap rows (asserted)."""
    df = V.load_drive(drive_id); t = df["t_s"].to_numpy(); k0, k1 = int(np.searchsorted(t, a, "left")), int(np.searchsorted(t, b, "left")); s = df.iloc[k0:k1]; n = len(s)
    assert n == round((b - a) * HZ) and int(s["gap"].sum()) == 0, (drive_id, a, b, n)
    flag = lambda c: [int(v) for v in s[c].to_numpy().astype(bool)]
    cols = {"t": [num(t_off + i / HZ, 1) for i in range(n)], "v_ego_mps": nums(s["v_mps"], 2), "a_mps2": nums(s["a_mps2"], 2), "gas_pressed": flag("gas_pressed"), "brake_pressed": flag("brake_pressed"), "das_any": flag("das_any"),
            "lead_d_m": nums(np.where(s["lead_valid"].to_numpy(), s["lead_d_m"].to_numpy(dtype=float), np.nan), 1)}
    if "steer_angle_deg" in extra: cols["steer_angle_deg"] = nums(s["steer_angle_deg"], 1)
    if "yaw_rate_degps" in extra: cols["yaw_rate_degps"] = nums(np.degrees(s["yaw_rate_radps"].to_numpy(dtype=float)), 2)
    present = [k for k in cols if k != "t"]
    return {"schema": "signals/1", "id": clip_id, "hz": HZ, "n": n, "t0": num(t_off, 1), "duration_s": num(n / HZ, 1), "cols": cols, "labels": {k: LAB[k] for k in present}, "units": {k: UNI[k] for k in present if k in UNI},
            "ranges": {k: [0, 1] for k in ("gas_pressed", "brake_pressed", "das_any")}, "shade": [{"col": "das_any", "color": "accent", "alpha": 0.12, "label": "automation active"}],
            "events": [], "series": [], "bands": [], "fans": [], "thresholds": [], "meta": {"drive_id": drive_id, "span_s": [a, b], "das_any_share": num(s["das_any"].mean(), 3), "brake_pressed_share": num(s["brake_pressed"].mean(), 3), "v_max_mps": num(s["v_mps"].max(), 1)}}
def debounce(col, min_run):
    """0/1 column with runs shorter than min_run samples merged into the preceding state."""
    out = list(col); i = 0
    while i < len(out):
        j = i
        while j < len(out) and out[j] == out[i]: j += 1
        if i > 0 and j - i < min_run:
            for q in range(i, j): out[q] = out[i - 1]
        i = j
    return out
def span_events(sig, a, b, types, human_only=()):
    """Episode onsets inside the span (kinds liftoff / brake / stop / launch / turn; a lift-off under automation is labelled as such) + automation edges."""
    drive_id = sig["meta"]["drive_id"]; off = float(sig["t0"]); eps = episodes(drive_id); sel = eps[(eps["t_on"] >= a) & (eps["t_on"] < b) & eps["type"].isin(types)].sort_values("t_on"); ev, detail = [], []
    for r in sel.itertuples():
        if r.type in human_only and r.das_any_frac > 0: continue
        kind, label, glyph = EV[r.type]
        if r.type == "DEC_LIFT" and r.das_any_frac > 0.5: kind, label = "liftoff_das", "deceleration under automation, brake not pressed"
        ev.append({"t": num(r.t_on - a + off, 1), "kind": kind, "label": label, "glyph": glyph})
        detail.append({"type": r.type, "t": num(r.t_on - a + off, 1), "dur_s": num(r.dur_s, 1), "dv_mps": num(r.dv, 2), "peak_a_mps2": num(r.peak_a, 2), "das_any_frac": num(r.das_any_frac, 2), "brake_frac": num(r.brake_frac, 2)})
    c = sig["cols"]; das = debounce(c["das_any"], int(HZ))          # edges of runs ≥ 1 s only (the flag flickers around engage / disengage); the shade keeps the raw column
    for i in edges(das, True): ev.append({"t": c["t"][i], "kind": "engage", "label": "automation activity starts", "glyph": "+"})
    for i in edges(das, False): ev.append({"t": c["t"][i], "kind": "disengage", "label": "automation activity ends", "glyph": "−"})
    ev.sort(key=lambda e: e["t"]); sig["events"] = ev; sig["meta"]["episodes"] = detail; return ev
def step_series(drive_id, tags, a, b, cls, sid, label, color, t_off=0.0):
    """One value per scored 60-s window that overlaps [a, b): t = window end (t0_s + 60) on the clip clock (+ t_off), v = P(cls)."""
    pr = V.probs_for_drive(drive_id, tags); w = pr[(pr["t1_s"] > a) & (pr["t0_s"] < b)]
    return ({"id": sid, "label": label, "unit": "", "color": color, "style": "step", "window_s": 60.0, "t": [num(float(x) + 60.0 - a + t_off, 1) for x in w["t0_s"]], "v": nums(w[f"p_{cls}"], 3)},
            [{"w_idx": int(x.w_idx), "t0_s": num(x.t0_s, 1), "p": num(getattr(x, f"p_{cls}"), 3), "das_any_frac": num(x.das_any_frac, 3)} for x in w.itertuples()])
def decision(drive_id, tags):
    d = V.decide(drive_id, tags); return {"cls": d["cls"], "prob": num(d["prob"], 3), "truth": d["truth"], "correct": bool(d["correct"]), "n_windows": d["n_windows"], "tags": list(tags), "mean": {c: num(m, 3) for c, m in zip(d["classes"], d["mean"])}}
def dstr(d): return f"{d['cls']} {d['prob']:.2f}"
S80 = "scale=trunc(iw*0.8/2)*2:trunc(ih*0.8/2)*2"; S75 = "scale=trunc(iw*0.75/2)*2:trunc(ih*0.75/2)*2"
def fit_clip(drive_id, a, b, dst, cap):
    """Staged re-encodes of the forward camera until the mp4 fits the cap: the 60-90 s cases start at the native 20 fps, the 180-s hero at 10 fps; then a smaller frame."""
    stages = [(30, 10, None), (32, 10, None), (34, 10, None), (32, 10, S80), (34, 10, S80), (34, 10, S75)] if b - a > 100 else [(28, None, None), (30, None, None), (32, None, None), (30, 10, None), (32, 10, None), (34, 10, None), (34, 10, S75)]
    for crf, fps, scale in stages:
        info = V.cut_clip(drive_id, a, b, dst, crf=crf, fps=fps, scale=scale)
        if os.path.getsize(dst) <= cap: break
    assert os.path.getsize(dst) <= cap and abs(info["duration_s"] - (b - a)) < 0.5, (drive_id, a, b, info["duration_s"], os.path.getsize(dst)); return info
def make_poster(mp4, jpg, t):
    poster(mp4, jpg, t, q=5)
    if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=960, cap_bytes=CAPS["poster_bytes"], q0=72)

# ---------------------------------------------------------------- A. hero: Tesla Model Y (held-out BEV), 1:00-4:00 = windows 1-3, lift-off decelerations
HERO = "drive_309083"; HA, HB = 60.0, 240.0; hinfo = V.drive_info(HERO)
sig = span_signals(HERO, HA, HB, "hero", t_off=HA); span_events(sig, HA, HB, ("DEC_LIFT",), human_only=("DEC_LIFT",))   # t = drive time: the hero scrubber and the whole-drive timeline share one sync group
se, wins = step_series(HERO, [PBEV], HA, HB, "BEV", "pbev", "P(BEV) · 1-D ResNet B5 · 60-s window", "accent", t_off=HA); sig["series"] = [se]
sig["thresholds"] = [{"col": "pbev", "v": 0.5, "label": "decision threshold 0.5", "color": "mute", "style": "dash"}]
hdec = decision(HERO, [PBEV]); assert hdec["cls"] == "BEV" and abs(hdec["prob"] - 0.93) < 0.01, hdec
mp4 = os.path.join(MEDIA, "hero.mp4"); jpg = os.path.join(MEDIA, "hero.jpg"); h = entry_hash({"d": HERO, "a": HA, "b": HB, "cap": CAPS["video_bytes"]}, table_path(HERO), VIZLIB)
lift = [e["t"] - HA for e in sig["events"] if e["kind"] == "liftoff"]; hero_key_t = lift[0] if lift else 75.0   # clip seconds (poster frame, key moment)
if A.force or not ledger.done("hero_clip", h) or not os.path.exists(mp4) or not os.path.exists(jpg):
    ci = fit_clip(HERO, HA, HB, mp4, CAPS["video_bytes"]); make_poster(mp4, jpg, hero_key_t); ledger.mark("hero_clip", h, crf=ci["crf"], fps=ci["fps"], scale=ci["scale"], n_pieces=ci["n_pieces"])
pr = ffprobe(mp4); assert abs(pr["duration"] - (HB - HA)) < 0.5, pr["duration"]; led = ledger.rows["hero_clip"]
sig["media"] = {"video": "static/media/hero.mp4", "poster": "static/media/hero.jpg", "t0_video_s": 0.0, "aspect": f"{pr['width']}/{pr['height']}"}
sig["meta"].update({"model": hinfo["model"], "truth": {"powertrain": hinfo["powertrain"], "size_class": hinfo["size_class"], "footprint_m2": num(hinfo["footprint_m2"], 3)}, "decision": hdec, "decision_text": f"{dstr(hdec)} · true {hdec['truth']}", "windows": wins,
                    "clip": {"fps": led.get("fps") or 20, "crf": led.get("crf"), "scale": led.get("scale"), "n_pieces": led.get("n_pieces"), "duration_s": num(pr["duration"], 2)},
                    "source": "VTT build drive table (10 Hz) + saved test probabilities of the final 1-D ResNet (recipe B5, seed 1); forward camera 526×330 (pseudonymous held-out drive)",
                    "note": "1:00-4:00 of the drive = windows 1-3; the lift-off decelerations are DEC_LIFT episodes of experiments/episodes.py without automation activity",
                    "clock": "t is drive time (t0 = 60 s, video time 0 = t0) so the cursor of the whole-drive timeline in the same sync group lines up; the kit shows clip-relative clocks"})
put("signals_hero", "signals_hero.json", sig, first_view=True)
files["media_hero"] = media_entry("hero.mp4"); files["poster_hero"] = media_entry("hero.jpg")
items["hero_clip"] = {"id": "hero_clip", "kind": "clip", "title": f"Hero · {hinfo['model']} · 1:00-4:00 · lift-off decelerations · {HB - HA:.0f} s", "files": {"video": "static/media/hero.mp4", "poster": "static/media/hero.jpg", "signals": "static/data/signals_hero.json"},
                     "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": True, "duration_s": num(pr["duration"], 2), "key_moment": {"t": hero_key_t, "label": "lift-off deceleration"}, "poster_lqip": lqip(jpg),
                     "privacy": PRIV_ROAD("forward camera only (qcamera.ts pieces of a pseudonymous held-out drive) cut through vizlib.cut_clip; cabin video never opened; licence plates of other vehicles may be legible — review before publishing"),
                     "provenance": {"source": "raw forward-camera segments (private library) mapped through the private pseudonym table inside vizlib", "video": {"codec": pr["codec"], "fps": pr["fps"]}}, "entry_hash": h}
# timeline over the whole drive: automation per window, window decision (ResNet B5 seed 1), hero span marked
win = V.load_windows(HERO); prh = V.probs_for_drive(HERO, [PBEV]); pmap = dict(zip(prh["w_idx"].astype(int), prh["pred"])); dur = float(hinfo["duration_s"]); span = [0.0, num(dur, 1)]
def merged(states):
    segs = []
    for t0, t1, st in states:
        if segs and segs[-1][2] == st and abs(segs[-1][1] - t0) < 1e-6: segs[-1][1] = t1
        else: segs.append([t0, t1, st])
    if segs and segs[-1][1] < span[1]: segs.append([segs[-1][1], span[1], "na"])
    return segs
auto = merged([(num(w.t0_s, 1), min(num(w.t1_s, 1), span[1]), "on" if float(w.das_any_frac) >= 0.5 else "off") for w in win.itertuples()])
deci = merged([(num(w.t0_s, 1), min(num(w.t1_s, 1), span[1]), pmap.get(int(w.w_idx), "na")) for w in win.itertuples()])
tl = {"schema": "timeline/1", "span": span, "lanes": [{"id": "automation", "label": "automation activity (per 60-s window)", "segs": auto, "marks": []},
                                                      {"id": "decision", "label": "window decision · 1-D ResNet B5", "segs": deci, "colors": {"BEV": "accent", "ICE": "coral"},
                                                       "marks": [{"t": HA, "kind": "hero_start", "label": "hero clip starts (1:00)"}, {"t": HB, "kind": "hero_end", "label": "hero clip ends (4:00)"}]}],
      "meta": {"drive_id": HERO, "model": hinfo["model"], "truth": hinfo["powertrain"], "decision": hdec, "n_windows": int(len(win)), "n_windows_scored": int(len(prh)), "das_any_share_of_drive": num(hinfo["das_any_s"] / dur, 3),
               "windows_read_as": {"BEV": int((prh["pred"] == "BEV").sum()), "ICE": int((prh["pred"] == "ICE").sum())}, "states": "automation lane: on = das_any in ≥ 50 % of the window's samples; decision lane: arg-max of the window's P(BEV, ICE), na = window not scored (ineligible); colors = colour tokens of the free states (BEV = page accent, ICE = coral), read by the kit"}}
put("timeline_hero", "timeline_hero.json", tl, first_view=True)

# ---------------------------------------------------------------- B. six cases (held-out car models; forward camera + 10 Hz signals + window probabilities)
CASES = [dict(k=1, drive="drive_309083", a=150.0, b=220.0, types=("DEC_LIFT",), human_only=("DEC_LIFT",), bev=[PBEV], size=None, key="liftoff", why="lift-off decelerations without the brake pedal in human-driven city traffic"),
         dict(k=2, drive="drive_351637", a=5885.0, b=5950.0, types=("DEC_BRK",), human_only=(), bev=[PBEV], size=None, key="brake", why="brake-pedal decelerations in the last minute of a human-driven drive"),
         dict(k=3, drive="drive_868276", a=1770.0, b=1860.0, types=("DEC_LIFT", "DEC_BRK"), human_only=(), bev=RES_B5, size=None, key=None, why="the same car model driven by the automation for 92 % of the drive is read as ICE"),
         dict(k=4, drive="drive_017429", a=1770.0, b=1860.0, types=("DEC_LIFT", "DEC_BRK"), human_only=(), bev=RES_B5, size=None, key=None, why="the same car model with 40 % automation is read as BEV"),
         dict(k=5, drive="drive_618938", a=180.0, b=250.0, types=("STOP", "LAUNCH", "DEC_LIFT"), human_only=(), bev=[PBEV], size=[PSIZE], key="launch", why="pickup at a red light, launch and cruise; both tasks"),
         dict(k=6, drive="drive_570716", a=2520.0, b=2580.0, types=("TURN", "DEC_BRK", "DEC_LIFT"), human_only=(), bev=RES_B5, size=GRU_S9, key="turn", why="sharp turn out of a give-way junction; both tasks")]
EXPECT = {1: ("BEV", .93), 2: ("ICE", .86), 3: ("ICE", .95), 4: ("BEV", .82), 5: ("BEV", .65), 6: ("ICE", .83)}; EXPECT_SIZE = {5: ("LARGE", .66), 6: ("SMALL", .64)}
case_clips = []
for c in CASES:
    k, d, a, b = c["k"], c["drive"], c["a"], c["b"]; info = V.drive_info(d); cid = f"case{k}"
    sigc = span_signals(d, a, b, cid, extra=("steer_angle_deg", "yaw_rate_degps")); span_events(sigc, a, b, c["types"], human_only=c["human_only"])
    se, wins = step_series(d, [PBEV], a, b, "BEV", "pbev", "P(BEV) · 1-D ResNet B5 · 60-s window", "accent"); sigc["series"] = [se]; sigc["thresholds"] = [{"col": "pbev", "v": 0.5, "label": "decision threshold 0.5", "color": "mute", "style": "dash"}]
    meta_w = {"pbev": wins}
    if c["size"]:
        for cls, sid, col in (("LARGE", "plarge", "violet"), ("SMALL", "psmall", "mint")):
            s2, w2 = step_series(d, [PSIZE], a, b, cls, sid, f"P({cls}) · bi-GRU S9 · 60-s window", col); sigc["series"].append(s2); meta_w[sid] = w2
        sigc["thresholds"].append({"col": "plarge", "v": num(1 / 3, 3), "label": "chance (1/3)", "color": "mute", "style": "dash"})
    dec = decision(d, c["bev"]); assert dec["cls"] == EXPECT[k][0] and abs(dec["prob"] - EXPECT[k][1]) < 0.011, (k, dec)
    decs = {"bev_ice": dec}; parts = [dstr(dec)]; truth = [dec["truth"]]
    if c["size"]:
        ds = decision(d, c["size"]); assert ds["cls"] == EXPECT_SIZE[k][0] and abs(ds["prob"] - EXPECT_SIZE[k][1]) < 0.011, (k, ds); decs["size"] = ds; parts.insert(0, dstr(ds)); truth.insert(0, ds["truth"])
    das_drive = float(info["das_any_s"]) / float(info["duration_s"]); sub = " · ".join(parts) + " · true " + " / ".join(truth) + (f" · {100 * das_drive:.0f} % automation" if k in (3, 4) else "")
    cmp4 = os.path.join(MEDIA, f"{cid}.mp4"); cjpg = os.path.join(MEDIA, f"{cid}.jpg"); ch = entry_hash({"d": d, "a": a, "b": b, "cap": CASE_CAP}, table_path(d), VIZLIB)
    keys = [e["t"] for e in sigc["events"] if e["kind"] == c["key"]] if c["key"] else []; key_t = keys[0] if keys else num((b - a) / 2, 1)
    if A.force or not ledger.done(f"{cid}_clip", ch) or not os.path.exists(cmp4) or not os.path.exists(cjpg):
        ci = fit_clip(d, a, b, cmp4, CASE_CAP); make_poster(cmp4, cjpg, key_t); ledger.mark(f"{cid}_clip", ch, crf=ci["crf"], fps=ci["fps"], scale=ci["scale"], n_pieces=ci["n_pieces"])
    cpr = ffprobe(cmp4); assert abs(cpr["duration"] - (b - a)) < 0.5, (cid, cpr["duration"]); led = ledger.rows[f"{cid}_clip"]
    sigc["media"] = {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "t0_video_s": 0.0, "aspect": f"{cpr['width']}/{cpr['height']}"}
    sigc["meta"].update({"model": info["model"], "truth": {"powertrain": info["powertrain"], "size_class": info["size_class"], "footprint_m2": num(info["footprint_m2"], 3)}, "decisions": decs, "decision_text": sub, "windows": meta_w, "why": c["why"],
                         "das_any_share_of_drive": num(das_drive, 3), "drive_duration_s": num(info["duration_s"], 1), "series_tags": {"pbev": PBEV, **({"plarge": PSIZE, "psmall": PSIZE} if c["size"] else {})},
                         "clip": {"fps": led.get("fps") or 20, "crf": led.get("crf"), "scale": led.get("scale"), "n_pieces": led.get("n_pieces"), "duration_s": num(cpr["duration"], 2)},
                         "source": "VTT build drive table (10 Hz) + saved test probabilities; forward camera 526×330 (pseudonymous held-out drive)"})
    put(f"signals_{cid}", f"signals_{cid}.json", sigc)
    files[f"media_{cid}"] = media_entry(f"{cid}.mp4"); files[f"poster_{cid}"] = media_entry(f"{cid}.jpg")
    items[f"{cid}_clip"] = {"id": f"{cid}_clip", "kind": "clip", "title": f"Case {k} · {info['model']} · {V.fmt_mmss(a)}-{V.fmt_mmss(b)} · {b - a:.0f} s", "files": {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "signals": f"static/data/signals_{cid}.json"},
                            "bytes": {"video": cpr["bytes"], "poster": os.path.getsize(cjpg)}, "first_view": False, "duration_s": num(cpr["duration"], 2), "key_moment": {"t": key_t, "label": c["key"] or "mid-clip"}, "poster_lqip": lqip(cjpg),
                            "privacy": PRIV_ROAD("forward camera only (qcamera.ts pieces of a pseudonymous held-out drive) cut through vizlib.cut_clip; cabin video never opened; licence plates of other vehicles may be legible — review before publishing"),
                            "provenance": {"source": "raw forward-camera segments (private library) mapped through the private pseudonym table inside vizlib", "video": {"codec": cpr["codec"], "fps": cpr["fps"]}}, "entry_hash": ch}
    case_clips.append({"id": cid, "title": f"Case {k} · {info['model']}", "sub": sub, "src": f"static/data/signals_{cid}.json", "video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg"})
put("cases", "cases.json", {"schema": "clips/1", "default": "case1", "clips": case_clips, "meta": {"note": "Six held-out car models (split_platform test). Decisions: drive-level mean of the window probability vectors → arg-max; cases 1, 2 and the size decision of case 5 use one seed (as the demo figures), the others the 3-seed mean.",
                                                                                                   "tags": {"pbev_series": PBEV, "psize_series": PSIZE, "resnet_b5_seeds": RES_B5, "gru_s9_seeds": GRU_S9}}})

# ---------------------------------------------------------------- C. figures (demo gallery + paper figures) and the animation
FIG = [("demo01", DEMO, "demo01_bev_regen.png", True, "Lift-off decelerations of a held-out BEV (Tesla Model Y): stills, speed / acceleration / pedals, whole-drive P(BEV)"),
       ("demo02", DEMO, "demo02_ice_corolla.png", True, "Brake-pedal decelerations of a combustion car (Toyota Corolla): stills, pedals, whole-drive P(ICE)"),
       ("demo03", DEMO, "demo03_model_s_das.png", True, "Same car model, two drives (Tesla Model S): 92 % automation read as ICE, 40 % read as BEV"),
       ("demo04", DEMO, "demo04_lightning_large.png", True, "Pickup at a red light, launch, cruise (Ford F-150 Lightning): size and powertrain tracks"),
       ("demo05", DEMO, "demo05_large_unibody_ceiling.png", True, "Large unibody cars read as MID / SMALL; LARGE training hours come mostly from pickups"),
       ("demo06", DEMO, "demo06_kona_both_tasks.png", True, "Sharp turn out of a junction (Hyundai Kona): steering, yaw rate, curvature; both tasks"),
       ("demo07", DEMO, "demo07_evidence_accumulation.png", True, "Evidence accumulation along a 5-h drive (Kia Stinger): running drive-level mean"),
       ("demo08", DEMO, "demo08_mil_attention.png", True, "Episode-MIL attention per instance type and the most-attended episodes"),
       ("demo09", DEMO, "demo09_fleet_overview.png", False, "Every held-out car model: size decisions against footprint, mean P(BEV) per model"),
       ("demo10_poster", DEMO, "demo10_animation.png", True, "Poster frame of the animated minute (end of the window, decision visible)"),
       ("arch01", DEMO, "arch01_window_recipe.png", False, "Window model and training recipe (augmentation, encoder, multi-task heads, sampler, loss)"),
       ("arch02", DEMO, "arch02_episode_mil.png", False, "Episode-MIL model: episode types, instance encoders, gated attention, drive-level heads"),
       ("arch03", DEMO, "arch03_protocol.png", False, "Evaluation design: 41 held-out car models, internal folds, window → drive → vehicle levels"),
       ("evidence", PFIG, "evidence_sufficiency.png", False, "Evidence sufficiency: drive-level macro-F1 against windows sampled per drive"),
       ("ceiling", PFIG, "footprint_noise_oracle.png", False, "Footprint-noise oracle with the achieved and majority-oracle lines")]
for key, sdir, name, pixels, title in FIG:
    src = os.path.join(sdir, name); fname = "fig_demo10.jpg" if key == "demo10_poster" else f"fig_{key}.jpg"; dst = os.path.join(MEDIA, fname); h = entry_hash({"k": key}, src)
    if A.force or not ledger.done("fig_" + key, h) or not os.path.exists(dst): jpeg_fit(src, dst, max_w=2000, cap_bytes=CAPS["figure_bytes"]); ledger.mark("fig_" + key, h)
    files["fig_" + key] = media_entry(fname)
    items["fig_" + key] = {"id": "fig_" + key, "kind": "figure", "title": title, "files": {"image": f"static/media/{fname}"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": key == "demo01",
                           "privacy": {"kind": "figure", "source_pixels": pixels, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "demo / paper figure; " + ("embeds forward-camera stills of pseudonymous held-out drives (plates may be legible)" if pixels else "no camera pixels")},
                           "provenance": {"source": name}, "entry_hash": h}
asrc = os.path.join(DEMO, "demo10_animation.mp4"); amp4 = os.path.join(MEDIA, "anim.mp4"); ajpg = os.path.join(MEDIA, "anim.jpg"); ah = entry_hash({"k": "anim", "cap": CAPS["video_bytes"]}, asrc)
if A.force or not ledger.done("anim", ah) or not os.path.exists(amp4) or not os.path.exists(ajpg):
    fit_cap(lambda crf, scale: h264(asrc, amp4, crf=crf, scale=scale or "scale=960:-2"), amp4, CAPS["video_bytes"]); make_poster(amp4, ajpg, 50.0); ledger.mark("anim", ah)
apr = ffprobe(amp4); files["media_anim"] = media_entry("anim.mp4"); files["poster_anim"] = media_entry("anim.jpg")
items["anim"] = {"id": "anim", "kind": "clip", "title": f"Animated minute · {hinfo['model']} · window 2 · {apr['duration']:.0f} s", "files": {"video": "static/media/anim.mp4", "poster": "static/media/anim.jpg"}, "bytes": {"video": apr["bytes"], "poster": os.path.getsize(ajpg)},
                 "first_view": False, "duration_s": num(apr["duration"], 2), "key_moment": {"t": 50.0, "label": "window decision"}, "poster_lqip": lqip(ajpg),
                 "privacy": PRIV_ROAD("rendered demo animation (demo10_animation.mp4) that embeds forward-camera frames of a pseudonymous held-out drive; cabin video never used; plates may be legible — review before publishing"),
                 "provenance": {"source": "demo10_animation.mp4 re-encoded", "video": {"codec": apr["codec"], "fps": apr["fps"], "size": f"{apr['width']}x{apr['height']}"}}, "entry_hash": ah}

# ---------------------------------------------------------------- D. leaderboards (experiments/RESULTS.md, split_platform; v = drive-level, v2 = window-level macro-F1)
# labels / notes are short on purpose: the kit renders them in a 150-190 px column (ellipsis beyond that); the full description stays in the results table of the page
BEV_ROWS = [("statistics + GBM", 73.2, 69.5, "mute", False, None), ("LLM + stats + GBM", 80.9, 73.2, "mute", False, None), ("1-D ResNet", 91.1, 78.4, None, False, "reference"),
            ("bi-GRU", 89.0, 79.2, None, False, "reference"), ("Transformer", 88.4, 77.0, None, False, "reference"), ("Mamba-2", 89.4, 77.3, None, False, "reference"),
            ("ResNet B5 · final", 93.0, 79.9, None, True, None), ("episode MIL", 90.2, 78.8, None, False, None)]
SIZE_ROWS = [("statistics + GBM", 54.7, 49.7, "mute", False, None), ("LLM + stats + GBM", 64.9, 54.1, "mute", False, None), ("1-D ResNet", 61.1, 53.6, None, False, "reference"),
             ("bi-GRU", 62.9, 54.7, None, False, "reference"), ("Transformer", 61.8, 52.5, None, False, "reference"), ("Mamba-2", 61.2, 53.1, None, False, "reference"),
             ("bi-GRU S9 · final", 67.1, 53.2, None, True, None), ("episode MIL", 64.6, 54.2, None, False, None)]
def bars(rows, task): return {"schema": "bars/1", "unit": "", "max": 100, "dp": 1, "v2_dp": 1, "rows": [{"label": l, "v": v, "v2": v2, "color": col, "emph": em, "note": nt} for l, v, v2, col, em, nt in rows], "meta": {"source": f"experiments/RESULTS.md · split_platform · {task}", "v": "drive_full macro-F1 (mean of the window probability vectors per test drive)", "v2": "window test_full macro-F1", "chance": "about 50 (BEV vs ICE) / 33 (size)",
                                                                                                                                                              "seeds": "reference models and final recipes: mean of 3 seeds (std 0.0-1.3 at drive level); feature baselines: 1 run", "final_other": "bi-GRU B5 92.6 / 1-D ResNet S9 66.8 drive-level", "mil": "window-mean aggregation; own bag prediction 93.0 (BEV vs ICE) / 64.3 (size)"}}
put("bars_bev", "bars_bev.json", bars(BEV_ROWS, "BEV vs ICE")); put("bars_size", "bars_size.json", bars(SIZE_ROWS, "size (SMALL / MID / LARGE)"))

# ---------------------------------------------------------------- E. held-out car models: paired (reference → final recipe), scatter (footprint vs share correct), P(BEV) histogram
WI = V.windows_index().set_index("window_id"); DI = V.drives_index()
def shares(tags, task):
    """per held-out car model: share of its test drives decided correctly by the drive_full rule (mean of the window probability vectors → arg-max), and the number of drives."""
    probs, classes = V.mean_over_seeds(tags); ids = list(probs); P = np.vstack([probs[i] for i in ids]); df = pd.DataFrame(P, columns=list(classes)); df["drive_id"] = WI.loc[ids, "drive_id"].to_numpy()
    m = df.groupby("drive_id")[list(classes)].mean(); pred = np.array(classes)[m.to_numpy().argmax(1)]; lab = DI.loc[m.index, V.TASK_LABEL_COL[task]].astype(str).to_numpy(); mod = DI.loc[m.index, "model"].to_numpy()
    return pd.DataFrame({"model": mod, "ok": (pred == lab).astype(float)}).groupby("model")["ok"].agg(share="mean", n="size")
T = DI[(DI["split_platform"] == "test") & DI["task_size_eligible"]]; mode = lambda s: s.fillna("other").astype(str).mode().iloc[0]
MM = T.groupby("model").agg(fp=("footprint_m2", "mean"), fp_min=("footprint_m2", "min"), fp_max=("footprint_m2", "max"), size_class=("size_class", mode), powertrain=("powertrain", mode), n_drives=("drive_id", "size")).sort_values("fp")
groups = []
for gid, label, task, ref, fin, chance in (("bev", "BEV vs ICE", "bev_ice", REF_RES, RES_B5, 0.5), ("size", "size class", "size", REF_GRU, GRU_S9, num(1 / 3, 3))):
    J = shares(ref, task).join(shares(fin, task), lsuffix="_a", rsuffix="_b"); J = J.loc[[m for m in MM.index if m in J.index]]
    rows = [{"id": m, "label": m, "a": num(r.share_a, 3), "b": num(r.share_b, 3), "n": int(r.n_a), "emph": m in EMPH, "fp": num(MM.loc[m, "fp"], 2), "cls": MM.loc[m, "size_class" if task == "size" else "powertrain"]} for m, r in J.iterrows()]
    groups.append({"id": gid, "label": f"{label} · share of a held-out car model's test drives decided correctly", "n": len(rows), "delta": num(float(np.mean([r["b"] - r["a"] for r in rows])), 3), "chance": chance, "cost": False,
                   "note": f"chance {chance:.2f} · reference recipe → final recipe, each the mean of 3 seeds · rows ordered by footprint", "rows": rows})
put("paired_models", "paired_models.json", {"schema": "paired/1", "mode": "dumbbell", "axis": {"min": 0, "max": 1, "label": "share of drives correct"}, "from": "reference recipe (1-D ResNet / bi-GRU)", "to": "final recipe (ResNet B5 / GRU S9)", "groups": groups,
                                            "meta": {"source": "saved split_platform test probabilities (3 seeds each), drive_full rule per drive, grouped by held-out car model", "chance_per_group": "groups[].chance (0.5 for BEV vs ICE, 0.333 for size); the kit's single axis.chance is left unset",
                                                     "bev_ref": REF_RES, "bev_final": RES_B5, "size_ref": REF_GRU, "size_final": GRU_S9, "emph": EMPH}})
SF = shares(GRU_S9, "size"); xs = MM["fp"].to_numpy(dtype=float); ys = SF.loc[MM.index, "share"].to_numpy(dtype=float); names = list(MM.index)
pt = [str(v) if str(v) in ("BEV", "ICE", "HEV", "PHEV") else "other" for v in MM["powertrain"]]
bb = [num(xs.min(), 4), 0.0, num(xs.max(), 4), 1.0]; xi = np.round((xs - bb[0]) / (bb[2] - bb[0]) * 64000 - 32000).astype("<i2"); yi = np.round(ys * 64000 - 32000).astype("<i2"); inter = np.empty(2 * len(xs), dtype="<i2"); inter[0::2] = xi; inter[1::2] = yi
from common import b64_i16, b64_u16
def dim(labels, order): idx = {u: i for i, u in enumerate(order)}; return {"names": list(order), "idx": b64_u16(np.array([idx[l] for l in labels], dtype="<u2"))}
reps = [{"dim": "model", "name": m, "label": f"{m} · {MM.loc[m, 'size_class']} · {MM.loc[m, 'powertrain'] if pd.notna(MM.loc[m, 'powertrain']) else 'other'} · {MM.loc[m, 'fp']:.2f} m² · {100 * SF.loc[m, 'share']:.0f} % of {int(SF.loc[m, 'n'])} drives correct", "i": names.index(m)} for m in EMPH]
put("scatter_models", "scatter_models.json", {"schema": "embedding/1", "n": len(names), "bbox": bb, "xy_i16": b64_i16(inter),
    "dims": {"size_class": dim(list(MM["size_class"]), ["SMALL", "MID", "LARGE"]), "powertrain": dim(pt, ["BEV", "ICE", "HEV", "PHEV", "other"]), "model": dim(names, names)}, "reps": reps,
    "meta": {"axes": {"x": "footprint (m²)", "y": "share of drives decided correctly (size)"}, "ticks": {"x": [4.0, 4.5, 5.0, 5.5, 6.0], "y": [0, 0.25, 0.5, 0.75, 1], "dp": {"x": 1}}, "point_noun": "car models", "vlines": [{"x": 4.43, "label": "SMALL | MID"}, {"x": 4.88, "label": "MID | LARGE"}],
             "guides": [{"axis": "x", "v": num((4.43 - bb[0]) / (bb[2] - bb[0]), 4), "label": "4.43 m²"}, {"axis": "x", "v": num((4.88 - bb[0]) / (bb[2] - bb[0]), 4), "label": "4.88 m²"}], "model": "bi-GRU recipe S9, mean of 3 seeds, split_platform test, drive_full rule",
             "footprint": "drive-weighted mean of the platform footprints of the model's test drives (several generations for some models)", "labels": "size_class / powertrain = majority label among the model's size-eligible test drives (e.g. most Toyota Corolla test drives are HEV)", "footprint_ranges": {m: [num(r.fp_min, 3), num(r.fp_max, 3)] for m, r in MM.iterrows() if r.fp_max - r.fp_min > 1e-6},
             "n_drives": {m: int(v) for m, v in MM["n_drives"].items()}, "shares": {m: num(v, 3) for m, v in SF["share"].items()}, "source": "saved split_platform test probabilities + build index (held-out car models)"}})
z = np.load(os.path.join(V.RESULTS_DIR, PBEV + "_probs.npz"), allow_pickle=True); pb = np.asarray(z["probs"], float)[:, 0]; yy = np.asarray(z["y"]).astype(int)
lab = WI.loc[z["window_id"].astype(str), "powertrain"].astype(str).to_numpy(); assert ((lab == "BEV") == (yy == 0)).all(), "class order"   # classes [BEV, ICE]
bins = np.minimum((pb / 0.05).astype(int), 19); grp = lambda m, gid, label: {"id": gid, "label": label, "counts": [int(v) for v in np.bincount(bins[m], minlength=20)], "n": int(m.sum()), "mean": num(pb[m].mean(), 3)}
put("hist_pbev", "hist_pbev.json", {"schema": "hist/1", "bin_w": 0.05, "x0": 0, "unit": "", "groups": [grp(yy == 0, "bev", "true BEV windows"), grp(yy == 1, "ice", "true ICE windows")], "lines": [{"v": 0.5, "label": "decision threshold 0.5", "color": "coral"}],
                                    "meta": {"source": f"{PBEV}_probs.npz · window P(BEV) over the 18,295 split_platform test windows", "accuracy": num(((pb >= 0.5) == (yy == 0)).mean(), 3)}})

# ---------------------------------------------------------------- F. sources / numbers / manifest / checksums
sources = [
    {"id": "hf-card", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card · At a glance", "quote": "9,062 drives (3,949.8 h) from 1,431 pseudonymous vehicles … and 201,390 eligible 60 s windows"},
    {"id": "hf-license", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card · License", "quote": "The data tables are released under CC BY 4.0"},
    {"id": "hf-splits", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card · Splits", "quote": "41 held-out models, chosen so that a brand contributes both powertrain classes where possible"},
    {"id": "hf-models", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card · At a glance", "quote": "Vehicle platforms / brands / models 360 / 38 / 174"},
    {"id": "gh-results-bev", "kind": "github", "url": GHBLOB + "experiments/RESULTS.md", "date": TODAY, "locator": "experiments/RESULTS.md · split_platform · BEV vs ICE", "quote": "1-D ResNet, recipe B5 … drive full 93.0 ± 0.8 … bi-GRU, recipe B5 … 92.6 ± 0.1 … vehicle full 93.4 ± 0.4"},
    {"id": "gh-results-size", "kind": "github", "url": GHBLOB + "experiments/RESULTS.md", "date": TODAY, "locator": "experiments/RESULTS.md · split_platform · size", "quote": "bi-GRU, recipe S9 … window full 53.2 ± 0.3 … drive full 67.1 ± 0.0; bi-GRU … 62.9 ± 0.8"},
    {"id": "gh-results-ref", "kind": "github", "url": GHBLOB + "experiments/RESULTS.md", "date": TODAY, "locator": "experiments/RESULTS.md · split_platform tables (reference models, feature baselines, episode MIL)", "quote": "1-D ResNet 91.1 · bi-GRU 89.0 · Transformer 88.4 · Mamba-2 89.4 · episode MIL 90.2 (BEV vs ICE drive full)"},
    {"id": "gh-ci", "kind": "github", "url": GHBLOB + "paper/tables/ci.json", "date": TODAY, "locator": "paper/tables/ci.json · drive_full · 95 % cluster bootstrap over car models", "quote": "ResNet B5 93.0 [87.2, 96.6]; GRU S9 67.1 [54.4, 74.2]"},
    {"id": "gh-oracles", "kind": "github", "url": GHBLOB + "experiments/ORACLES.md", "date": TODAY, "locator": "experiments/ORACLES.md · footprint-noise, majority and curb-mass oracles, separability", "quote": "sigma 0.10 → 92.1, 0.15 → 86.6, 0.20 → 80.7; majority oracle 72.0; curb-mass oracle 63.3; 21 of 41 within 0.15 m²"},
    {"id": "gh-paper", "kind": "github", "url": GHBLOB + "paper/main_authors.pdf", "date": TODAY, "locator": "paper/main_authors.pdf (IEEE IV 2027 submission draft)", "quote": "Reading Vehicle Size and Powertrain from Motion"},
    {"id": "log-cases", "kind": "log", "url": None, "date": TODAY, "locator": "saved split_platform test probabilities (experiments/results/*_probs.npz), drive_full rule", "quote": "Model Y BEV 0.93 · Corolla ICE 0.86 · Model S ICE 0.95 / BEV 0.82 · Lightning LARGE 0.66 · Kona SMALL 0.64"},
    {"id": "log-models", "kind": "log", "url": None, "date": TODAY, "locator": "per held-out car model share of test drives decided correctly (reference vs final recipe, 3-seed means)", "quote": f"size: G90 {groups[1]['rows'][[r['id'] for r in groups[1]['rows']].index('Genesis G90')]['a']:.3f} → {groups[1]['rows'][[r['id'] for r in groups[1]['rows']].index('Genesis G90')]['b']:.3f}; Lightning 0.955"},
    {"id": "log-hist", "kind": "log", "url": None, "date": TODAY, "locator": f"{PBEV}_probs.npz · window P(BEV) histogram over the test windows", "quote": f"window accuracy at 0.5: {100 * ((pb >= 0.5) == (yy == 0)).mean():.1f} %"}]
assert all(len(x.get("quote") or "") <= 120 for x in sources), [x["id"] for x in sources if len(x.get("quote") or "") > 120]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg, on = {}, False
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("vtt:"): on = True; continue
    if not line.startswith(" ") and line.strip(): on = False
    if on and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
assert len(reg) == 19, reg.keys()
put("numbers", "numbers.json", {"schema": "numbers/1", "page": "vtt", "numbers": reg}, first_view=True)
first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"].get("poster", 0) + it["bytes"].get("image", 0) + (it["bytes"].get("video", 0) if it["id"] == "hero_clip" else 0) for it in items.values() if it.get("first_view"))
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "vtt", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": carry_review(list(items.values()), os.path.join(DATA, "manifest.json"))}
write_json(os.path.join(DATA, "manifest.json"), manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view {first/1e6:.2f} MB (hero video counted)")
assert total <= CAPS["total_media_bytes"] and first <= CAPS["first_view_bytes"], (total, first)
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
