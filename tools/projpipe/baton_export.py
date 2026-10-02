#!/usr/bin/env python3
"""BATON page exports — LOCAL. Inputs: the public BATON-Sample route driver_97/route_23 (qcamera + CSVs, fetched with the read token at
runtime; dcamera never), the benchmark event tables, the paper's case-study JSON + road frames, and figures from BATON_Paper/figs.
Usage: baton_export.py [--force]"""
import argparse, csv, glob, json, os, re, shutil, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, nums, signals_from_baton_csv, timeline_from_signals, h264, fit_cap, poster, lqip, jpeg_fit, ffprobe, sha256_file, entry_hash, Ledger
REPO = PATHS["repo"]; D = PATHS["drive"]; PAGE = os.path.join(REPO, "baton"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media")
WORK = os.path.join(PATHS["work"], "baton"); HF = os.path.join(WORK, "hf"); FIGS = os.path.join(D, "BATON_Paper", "figs")
for d in (DATA, MEDIA, WORK): os.makedirs(d, exist_ok=True)
ARXIV = "https://arxiv.org/abs/2604.07263v2"; HFURL = "https://huggingface.co/datasets/HenryYHW/BATON"; TODAY = "2026-10-02"
ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); A = ap.parse_args()
files, items = {}, {}; ledger = Ledger(os.path.join(WORK, "ledger.jsonl")).load()
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:26s} {n/1024:7.1f} KB")
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}

# ---------------------------------------------------------------- A. route window with one handover and one takeover (official events)
ROUTE = "driver_97/route_23"; rd = os.path.join(HF, ROUTE); evs = []
for name in ("activation_events_or.csv", "takeover_events_or.csv"):
    for r in csv.DictReader(open(os.path.join(HF, "benchmark", name))):
        if r["route_id"] == ROUTE: evs.append((r["event_type"], float(r["event_time_sec"])))
acts = sorted(t for k, t in evs if k == "activation"); takes = sorted(t for k, t in evs if k == "takeover")
pair = next((a, b) for a in acts for b in takes if 10 < b - a < 80); T_A = max(0.0, pair[0] - 22.0); T_B = min(ffprobe(os.path.join(rd, "qcamera.mp4"))["duration"], pair[1] + 25.0)
sig = signals_from_baton_csv(rd, T_A, T_B, hz=10, clip_id="route_window", events_from=())
sig["events"] = [{"t": num(pair[0] - T_A, 2), "kind": "handover", "label": "Handover ↑ · driver engages the assistance system (official event)", "glyph": "↑"}, {"t": num(pair[1] - T_A, 2), "kind": "takeover", "label": "Takeover ↓ · driver takes control back (official event)", "glyph": "↓"}]
for i in range(len(sig["cols"]["t"])):  # DMS distraction edges as secondary events
    pass
sig["media"] = {"video": "static/media/route_window.mp4", "poster": "static/media/route_window.jpg", "t0_video_s": 0.0, "aspect": "526/330"}
sig["meta"].update({"source": "BATON-Sample (public, pseudonymous) · Honda Civic · front camera 526×330 + 10 Hz CSVs", "events": "benchmark/activation_events_or.csv + takeover_events_or.csv (or_v1 definition)", "window": [num(T_A, 1), num(T_B, 1)]})
put("signals_route", "signals_route.json", sig, first_view=True)
tl = timeline_from_signals(sig, lane_col="cc_enabled", lane_label="assistance engaged", extra=(("is_distracted", "DMS"),)); tl["lanes"][0]["marks"] = [{"t": e["t"], "kind": e["kind"], "label": e["label"].split(" · ")[0]} for e in sig["events"]]
put("timeline_route", "timeline_route.json", tl, first_view=True)
mp4 = os.path.join(MEDIA, "route_window.mp4"); jpg = os.path.join(MEDIA, "route_window.jpg"); h = entry_hash({"r": ROUTE, "a": T_A, "b": T_B}, os.path.join(rd, "qcamera.mp4"))
if A.force or not ledger.done("route_window", h) or not os.path.exists(mp4):
    fit_cap(lambda crf, scale: h264(os.path.join(rd, "qcamera.mp4"), mp4, t_a=T_A, t_b=T_B, crf=crf, scale=scale), mp4, 1_400_000); poster(mp4, jpg, pair[1] - T_A, q=5)
    if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=526, cap_bytes=CAPS["poster_bytes"], q0=72)
    ledger.mark("route_window", h)
pr = ffprobe(mp4); assert abs(pr["duration"] - (T_B - T_A)) < 0.3, (pr["duration"], T_B - T_A)
files["media_route_window"] = media_entry("route_window.mp4"); files["poster_route_window"] = media_entry("route_window.jpg")
items["route_window"] = {"id": "route_window", "kind": "clip", "title": f"Route window · handover + takeover · {T_B - T_A:.0f} s", "files": {"video": "static/media/route_window.mp4", "poster": "static/media/route_window.jpg", "signals": "static/data/signals_route.json"}, "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": True, "duration_s": num(pr["duration"], 2), "key_moment": {"t": num(pair[1] - T_A, 2), "label": "takeover"}, "poster_lqip": lqip(jpg),
                         "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "front camera only (qcamera), public sample route, pseudonymous driver; dcamera never downloaded"}, "provenance": {"source": "BATON-Sample qcamera.mp4", "video": {"codec": pr["codec"], "fps": pr["fps"]}}, "entry_hash": h}

# ---------------------------------------------------------------- B. openpilot vs BATON-WM case studies (road frames only)
cs = json.load(open(os.path.join(FIGS, "casestudy_data.json"))); groups = {"KIA_SPORTAGE_5TH_GEN": "A", "HYUNDAI_ELANTRA_2022_NON_SCC": "B"}; case_clips = []
for i, c in enumerate(cs["cases"], 1):
    model = c["route"].split("/")[0]; op_t = np.array(c["op_t"]) - c["event_t"]; op = np.array(c["op_any2"]); hz = 20
    t = np.round(np.arange(round((op_t[-1] - op_t[0]) * hz) + 1) / hz + op_t[0], 2); opv = np.interp(t, op_t, op)
    wins = c["windows"]; wt = [num(w["end"] - c["event_t"], 2) for w in wins]; wv = [num(w["score"], 4) for w in wins]
    sigc = {"schema": "signals/1", "id": f"case{i}", "hz": hz, "n": len(t), "t0": float(t[0]), "duration_s": num(t[-1] - t[0], 2), "cols": {"t": nums(t, 2), "op_p": nums(opv, 4)},
            "labels": {"op_p": "openpilot · P(disengage within 2 s)"}, "units": {}, "ranges": {"op_p": [0, max(0.35, float(op.max()) * 1.1)]},
            "series": [{"id": "wm", "label": "BATON-WM · takeover score (5-s window, 2-s stride)", "color": "accent", "style": "step", "window_s": 2.0, "t": wt, "v": wv}],
            "thresholds": [{"col": "op_p", "v": cs["ryg_green"], "label": "openpilot green", "color": "mint", "style": "dash"}, {"col": "op_p", "v": cs["ryg_yellow"], "label": "openpilot yellow (alert)", "color": "gold", "style": "dash"}, {"col": "wm", "v": num(cs["thr_ours"], 3), "label": f"BATON-WM τ = {cs['thr_ours']:.3f} (F1-optimal on validation)", "color": "accent", "style": "dash"}],
            "events": [{"t": 0.0, "kind": "takeover", "label": "Driver override (takeover) · t = 0", "glyph": "↓"}, {"t": num(c["frame_t"] - c["event_t"], 2), "kind": "frame", "label": "Road frame shown (3 s before)", "glyph": "▣"}], "shade": [], "bands": [], "fans": [],
            "media": {"poster": f"static/media/case{i}_frame.jpg", "aspect": "526/330"},
            "meta": {"protocol": "T3-D onset detection (leak-safe: driver inputs visible)", "split": "cross-driver test", "horizon_s": 3.0, "lead_s": num(c["lead"], 1), "lead_is_cap": abs(c["lead"] - 3.0) < 0.05, "v_ego_mps": num(c["frame_vego_ms"], 2), "route_group": groups.get(model, "?"), "vehicle": model.replace("_", " ").title(),
                     "op_series": "openpilot modelV2 disengage probability (any, 2 s) recovered from the route logs", "op_at_event": num(c["op_at_event"], 4), "op_max_pre10": num(c.get("op_max2_pre10_1"), 4), "thr_note": "F1-optimal threshold on the validation split", "first_alarm_rel_s": num(next((w["end"] - c["event_t"] for w in wins if w["score"] >= cs["thr_ours"]), None), 2)}}
    put(f"signals_case{i}", f"signals_case{i}.json", sigc)
    src = os.path.join(FIGS, f"casestudy_frame_case{i}.png"); dst = os.path.join(MEDIA, f"case{i}_frame.jpg"); jpeg_fit(src, dst, max_w=526, cap_bytes=CAPS["poster_bytes"], q0=78)
    files[f"poster_case{i}"] = media_entry(f"case{i}_frame.jpg")
    items[f"case{i}_frame"] = {"id": f"case{i}_frame", "kind": "figure", "title": f"Case {i} road frame", "files": {"image": f"static/media/case{i}_frame.jpg"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": False, "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "front-camera frame 3 s before the override (paper figure asset)"}, "provenance": {"source": os.path.basename(src)}, "entry_hash": entry_hash({"i": i}, src)}
    fa = sigc["meta"]["first_alarm_rel_s"]
    case_clips.append({"id": f"case{i}", "title": f"Case {i} · {model.replace('_', ' ').title()}", "sub": f"{c['frame_vego_ms']*3.6:.0f} km/h · group {groups.get(model,'?')} · first window ≥ τ at {fa:+.1f} s" if fa is not None else f"{c['frame_vego_ms']*3.6:.0f} km/h · group {groups.get(model,'?')} · no window ≥ τ", "src": f"static/data/signals_case{i}.json", "poster": f"static/media/case{i}_frame.jpg"})
put("cases", "cases.json", {"schema": "clips/1", "default": "case1", "clips": case_clips, "meta": {"thr_ours": num(cs["thr_ours"], 4), "ryg": {"green": cs["ryg_green"], "yellow": cs["ryg_yellow"]}, "note": "Four hand-picked cases; openpilot predictions exist for 26 benchmark routes (5 in the test split) — exploratory, as in the paper. All four are crawl / stop-and-go takeovers."}})

# ---------------------------------------------------------------- C. figures (no cabin pixels)
FIG = [("task_distribution", "TaskDistribution_v2.png", 2000, 300_000, None), ("overview_signals", "BenchmarkOverview_panelB.png", 2000, 300_000, None), ("dataset_overview", "DatasetOverview.jpg", 2200, 400_000, None),
       ("panel_map", "panels_v2/panel_map.png", 2000, 300_000, None), ("panel_stats", "panels_v2/panel_stats.png", 1500, 250_000, None), ("panel_drivers", "panels_v2/panel_drivers.png", 1500, 250_000, None),
       ("experiment_method", "experiment_method.jpg", 1800, 300_000, (0.0, 0.0, 0.6, 1.0)), ("case1_composite", "CaseStudy_case1.png", 1950, 400_000, None)]
for key, name, w, cap, box in FIG:
    src = os.path.join(FIGS, name); dst = os.path.join(MEDIA, f"fig_{key}.jpg"); h = entry_hash({"k": key, "box": box}, src)
    if A.force or not ledger.done("fig_" + key, h) or not os.path.exists(dst): jpeg_fit(src, dst, max_w=w, cap_bytes=cap, box=box); ledger.mark("fig_" + key, h)
    files["fig_" + key] = media_entry(f"fig_{key}.jpg")
    items["fig_" + key] = {"id": "fig_" + key, "kind": "figure", "title": key, "files": {"image": f"static/media/fig_{key}.jpg"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": key == "overview_signals", "privacy": {"kind": "figure", "source_pixels": key in ("case1_composite", "experiment_method"), "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "cabin inset and street map cropped out" if key == "experiment_method" else "paper figure; road frames only"}, "provenance": {"source": name}, "entry_hash": h}

# ---------------------------------------------------------------- D. results tables (paper v2 body)
rows = [("Base rate", "—", .148, .037, .120, None, .035, None, False), ("GRU", "struct", .202, .072, .280, .119, None, None, False), ("TCN", "struct", .190, .058, .332, .167, None, None, False), ("Cross-Modal Transformer", "struct", .242, .103, .316, .135, None, None, False),
        ("V-JEPA2 fusion", "video + struct", .235, .089, .329, .161, None, None, False), ("RG-HBT-Q", "struct + video", .254, .111, .398, .230, .058, .026, False), ("DI-RG-HBT-Q", "struct + video", .219, .116, .366, .215, None, None, False), ("XGBoost", "CAN statistics", .236, .103, .479, .380, .056, .026, False), ("BATON-WM", "multimodal", .335, .171, .514, .413, .070, .040, True)]
put("results", "results.json", {"schema": "table/1", "caption": "Main transition results (cross-driver, h = 3 s, sample / event AUPRC, 3-seed mean; T2 and T3-D leak-safe, T3-A anticipation-safe with base rate 0.035)", "columns": ["Method", "Input", "T2 handover", "T3-D takeover detection", "T3-A takeover anticipation"],
    "rows": [{"method": m, "input": inp, "t2": [a, b], "t3d": [c, d], "t3a": [e, f], "emph": em} for m, inp, a, b, c, d, e, f, em in rows], "meta": {"source": "arXiv 2604.07263 v2 · Table: main transition results"}})
put("bars_t3", "bars_t3.json", {"schema": "bars/1", "unit": "", "max": 0.55, "rows": [{"label": m, "v": c, "v2": d, "emph": em, "color": "mute" if m == "Base rate" else None} for m, inp, a, b, c, d, e, f, em in rows if c is not None], "meta": {"source": "T3-D sample AUPRC (v) / event AUPRC (v2), arXiv v2"}})
put("bars_t2", "bars_t2.json", {"schema": "bars/1", "unit": "", "max": 0.4, "rows": [{"label": m, "v": a, "v2": b, "emph": em, "color": "mute" if m == "Base rate" else None} for m, inp, a, b, c, d, e, f, em in rows], "meta": {"source": "T2 sample AUPRC (v) / event AUPRC (v2), arXiv v2"}})

# ---------------------------------------------------------------- E. sources / numbers / preview / manifest
sources = [
    {"id": "arxiv-abs", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Abstract (v2 body)", "quote": "781 real-world DA routes from 173 unique drivers across 108 vehicle models, spanning 204.9 hours of driving"},
    {"id": "arxiv-frozen", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 3", "quote": "565 route bundles totaling 162.1 hours from 150 drivers and 99 car models"},
    {"id": "arxiv-events", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 3", "quote": "3,593 control-transition events"},
    {"id": "arxiv-fa", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 5.3", "quote": "At 1 false alarm per hour, the best T3-D model recalls only 28% of takeover events"},
    {"id": "arxiv-wm", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 5.2", "quote": "raises it from 0.236 to 0.335 (+42%)"},
    {"id": "arxiv-op", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 5.4", "quote": "the deployed predictor reaches 0.293 / 0.101 sample/event AUPRC on T3-D"},
    {"id": "arxiv-config", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 3.5", "quote": "a single configuration accounts for 96% of all transitions"},
    {"id": "arxiv-vehicle", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Sec. 4.4", "quote": "each driver drives their own vehicle"},
    {"id": "arxiv-protocols", "kind": "arxiv", "url": ARXIV, "version": "v2", "date": "2026-07-27", "locator": "Abstract", "quote": "onset detection (T3-D), where driver inputs are observable, and pre-override anticipation (T3-A)"},
    {"id": "hf-card", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card", "quote": "565 150 99 162.1 h 3,593"},
    {"id": "hf-license", "kind": "hf-card", "url": HFURL, "date": TODAY, "locator": "dataset card", "quote": "released for academic research use only under CC BY-NC 4.0"},
    {"id": "sample-route", "kind": "log", "url": None, "date": TODAY, "locator": "BATON-Sample route (public), benchmark event tables or_v1", "quote": f"handover at {pair[0]:.1f} s, takeover at {pair[1]:.1f} s of the route"},
    {"id": "casestudy", "kind": "log", "url": None, "date": TODAY, "locator": "paper case-study data (4 cases; openpilot modelV2 disengage probability from the route logs; BATON-WM window scores)", "quote": f"τ = {cs['thr_ours']:.3f}; openpilot green/yellow {cs['ryg_green']:.5f} / {cs['ryg_yellow']:.5f}"}]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg, on = {}, False
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("baton:"): on = True; continue
    if not line.startswith(" ") and line.strip(): on = False
    if on and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
put("numbers", "numbers.json", {"schema": "numbers/1", "page": "baton", "numbers": reg})
prev = {**{k: v for k, v in sig.items() if k != "cols"}, "id": "preview", "n": 30, "duration_s": 3.0, "cols": {k: v[:30] for k, v in sig["cols"].items() if k in ("t", "v_ego_mps", "cc_enabled", "is_distracted")}, "events": []}; put("preview", "preview.json", prev, first_view=True)
first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"].get("poster", 0) + it["bytes"].get("image", 0) for it in items.values() if it.get("first_view")); total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "baton", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": carry_review(list(items.values()), os.path.join(DATA, "manifest.json"))}
write_json(os.path.join(DATA, "manifest.json"), manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view {first/1e6:.2f} MB")
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
