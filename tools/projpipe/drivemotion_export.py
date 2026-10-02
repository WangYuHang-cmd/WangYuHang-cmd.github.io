#!/usr/bin/env python3
"""DriveMotion page exports — LOCAL (skeleton-only derivatives). Inputs: ODMS npz sequences (local AIDE/BATON demo outputs + one web
sequence fetched from the server), skeleton-only renders (transcoded), release-composition counts computed on the server,
hf_stage figure assets (pipeline/protocol/stats/qual/ddpm), the page's existing pred-vs-GT GIFs. Nothing with pixels of a person is exported.
Usage: drivemotion_export.py [--force]"""
import argparse, glob, json, os, re, shutil, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, nums, kpts_from_odms_npz, h264, fit_cap, poster, lqip, jpeg_fit, ffprobe, sha256_file, entry_hash, Ledger
REPO = PATHS["repo"]; D = PATHS["drive"]; PAGE = os.path.join(REPO, "drivemotion"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media"); IMG = os.path.join(PAGE, "static", "images")
WORK = os.path.join(PATHS["work"], "drivemotion"); ASSETS = os.path.join(WORK, "assets"); WEB = os.path.join(WORK, "web")
for d in (DATA, MEDIA, WORK): os.makedirs(d, exist_ok=True)
AIDE = os.path.join(D, "explore/opendriver_demo/out/aide_demo"); BAT = os.path.join(D, "explore/opendriver_demo/out/baton_demo")
ARXIV = "https://arxiv.org/abs/2609.08117v1"; HF = "https://huggingface.co/datasets/HenryYHW/DriveMotion"; TODAY = "2026-10-02"
ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); A = ap.parse_args()
files, items = {}, {}; ledger = Ledger(os.path.join(WORK, "ledger.jsonl")).load()
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:26s} {n/1024:7.1f} KB")
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}

# ---------------------------------------------------------------- skeleton sequences (kpts/1)
bm = json.load(open(os.path.join(BAT, "meta.json"))); z = np.load(os.path.join(BAT, "seq_BATON_HONDA_CIVIC_route0-17.npz")); can = z["can"]
brake = can[:, 3] > 0.5; steer = np.abs(np.nan_to_num(can[:, 1])); score = np.convolve(brake.astype(float) * 3 + steer / max(steer.max(), 1e-6), np.ones(400), "valid"); i0 = min(int(np.argmax(score)), len(can) - 400)
res = bm.get("native_res") or [1928, 1208]
kb = kpts_from_odms_npz(os.path.join(BAT, "seq_BATON_HONDA_CIVIC_route0-17.npz"), window=(i0, i0 + 400), seq_id="baton_fleet", part_names=bm.get("parts"), aspect=res[0] / res[1])
kb["labels"] = {"source": "BATON fleet · cabin fisheye", "vehicle": "Honda Civic", "with": "time-aligned CAN"}; kb["meta"] = {"source": "BATON fleet cabin camera → RTMW whole-body keypoints at 10 Hz · 40-s window chosen by brake/steering activity", "note": "gas channel identically 0 in this sequence; speed/steering/brake shown", "window_s": 40}
put("kpts_baton", "kpts_baton.json", kb, first_view=True)
for sess in ("0829", "0001"):
    meta = json.load(open(os.path.join(AIDE, f"meta_{sess}.json"))); labels = {k.replace("_label", "").replace("driver_", ""): v for k, v in (meta.get("labels") or {}).items()}; r = meta.get("native_res") or [1920, 1080]
    k = kpts_from_odms_npz(os.path.join(AIDE, f"seq_AIDE_{sess}.npz"), meta={"labels": labels}, seq_id=f"aide_{sess}", part_names=meta.get("parts") or ["head", "face", "torso", "Larm", "Rarm"], aspect=r[0] / r[1])
    k["labels"] = {"source": "AIDE (public) · in-car view", **labels}; k["meta"] = {"source": "AIDE in-car video → RTMW whole-body keypoints at 10 Hz · behaviour/emotion/scene labels from the dataset", "extractor": meta.get("extractor")}
    put(f"kpts_aide_{sess}", f"kpts_aide_{sess}.json", k)
web_npz = os.path.join(WEB, "dm_web_seq.npz")
if os.path.exists(web_npz):
    zz = np.load(web_npz, allow_pickle=True); n = len(zz["t"]); win = (0, min(n, 400))
    kw = kpts_from_odms_npz(web_npz, window=win, seq_id="web_span", part_names=["head", "face", "torso", "Larm", "Rarm"][: (zz["part_valid"].shape[1] if "part_valid" in zz.files else 5)], aspect=16 / 9)
    kw["labels"] = {"source": "web corpus · creator video, side view", "note": "skeleton only"}; kw["meta"] = {"source": "curated public in-cabin video → RTMW keypoints at 10 Hz; released skeleton-only, source clip not shown", "window_s": num((win[1] - win[0]) / 10, 1)}
    put("kpts_web", "kpts_web.json", kw)
put("seqs", "seqs.json", {"schema": "clips/1", "default": "baton_fleet", "clips": [{"id": "baton_fleet", "title": "BATON fleet", "sub": "cabin fisheye · with CAN · 40 s", "src": "static/data/kpts_baton.json"}, {"id": "aide_0829", "title": "AIDE", "sub": "Body Movement · Weariness · 12 s", "src": "static/data/kpts_aide_0829.json"}, {"id": "aide_0001", "title": "AIDE (short)", "sub": "Looking Around · 3 s", "src": "static/data/kpts_aide_0001.json"}] + ([{"id": "web_span", "title": "Web corpus", "sub": "side view · skeleton only", "src": "static/data/kpts_web.json"}] if os.path.exists(web_npz) else [])})

# ---------------------------------------------------------------- renders: skeleton-only videos (transcode mp4v → h264), GIFs → MP4
def vid(key, src, t_a=None, t_b=None, cap=1_200_000, fps=None, title="", note="", replaces=None):
    dst = os.path.join(MEDIA, key + ".mp4"); jpg = os.path.join(MEDIA, key + ".jpg"); h = entry_hash({"k": key, "a": t_a, "b": t_b}, src)
    if A.force or not ledger.done(key, h) or not os.path.exists(dst):
        fit_cap(lambda crf, scale: h264(src, dst, t_a=t_a, t_b=t_b, crf=crf, scale=scale, fps=fps), dst, cap); poster(dst, jpg, 1.0, q=5)
        if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=960, cap_bytes=CAPS["poster_bytes"], q0=70)
        ledger.mark(key, h)
    pr = ffprobe(dst); files["media_" + key] = media_entry(key + ".mp4"); files["poster_" + key] = media_entry(key + ".jpg")
    items[key] = {"id": key, "kind": "clip" if src.endswith(".mp4") else "gif2mp4", "title": title, "files": {"video": f"static/media/{key}.mp4", "poster": f"static/media/{key}.jpg"}, "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": False, "duration_s": num(pr["duration"], 2), "poster_lqip": lqip(jpg),
                  "privacy": {"kind": "skeleton", "source_pixels": False, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": note or "skeleton-only render; no source pixels"}, "provenance": {"source": os.path.basename(src), "video": {"codec": pr["codec"], "fps": pr["fps"]}}, "replaces": replaces or [], "entry_hash": h}
vid("render_baton", os.path.join(BAT, "motion_only_BATON.mp4"), t_a=i0 / 10, t_b=i0 / 10 + 40, cap=1_200_000, title="BATON fleet · skeleton render (40 s)", replaces=["static/images/dm_motion_baton.gif", "static/images/dm_overlay.gif"])
vid("render_aide", os.path.join(AIDE, "motion_only_AIDE_0829.mp4"), cap=500_000, title="AIDE · skeleton render (12 s)", replaces=["static/images/dm_motion_aide.gif"])
for g, key, title in [(os.path.join(ASSETS, "demo_web.gif"), "demo_web", "Web corpus · skeleton demo"), (os.path.join(IMG, "dm_pred_vs_gt_0.gif"), "pred_vs_gt_0", "Forecast vs ground truth · example 1"), (os.path.join(IMG, "dm_pred_vs_gt_1.gif"), "pred_vs_gt_1", "Forecast vs ground truth · example 2")]:
    src = g if os.path.exists(g) else os.path.join(MEDIA, key + ".mp4")
    if os.path.exists(src): vid(key, src, cap=600_000, fps=15, title=title, note="skeleton-only GIF already published, re-encoded", replaces=[f"static/images/{os.path.basename(g)}"] if g.startswith(IMG) else [])

# ---------------------------------------------------------------- figures (no people)
for src, key, w, cap in [(os.path.join(ASSETS, "pipeline.jpg"), "pipeline", 2000, 350_000), (os.path.join(ASSETS, "protocol.png"), "protocol", 2000, 350_000), (os.path.join(ASSETS, "stats.png"), "stats", 2000, 350_000), (os.path.join(ASSETS, "qual_dyn.jpg"), "qual_dyn", 2000, 350_000), (os.path.join(ASSETS, "ddpm_diversity.jpg"), "ddpm", 1600, 250_000),
                         (os.path.join(IMG, "dm_motion_energy.png"), "motion_energy", 1600, 250_000), (os.path.join(IMG, "dm_part_valid.png"), "part_valid", 1600, 200_000), (os.path.join(IMG, "dm_sequence.png"), "sequence", 1600, 300_000)]:
    if not os.path.exists(src): continue
    dst = os.path.join(MEDIA, f"fig_{key}.jpg"); h = entry_hash({"k": key}, src)
    if A.force or not ledger.done("fig_" + key, h) or not os.path.exists(dst): jpeg_fit(src, dst, max_w=w, cap_bytes=cap); ledger.mark("fig_" + key, h)
    files["fig_" + key] = media_entry(f"fig_{key}.jpg")
    items["fig_" + key] = {"id": "fig_" + key, "kind": "figure", "title": key, "files": {"image": f"static/media/fig_{key}.jpg"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": False, "privacy": {"kind": "figure", "source_pixels": key == "qual_dyn", "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "paper / release figure"}, "provenance": {"source": os.path.basename(src)}, "entry_hash": h}

# ---------------------------------------------------------------- composition + leaderboard + labels
comp = json.load(open(os.path.join(WEB, "dm_composition.json"))); stats = {"baton": {"n": 1329, "hours": 319.2}, "web": {"n": 3038, "hours": 71.7}, "aide": {"n": 2898, "hours": 2.4}}
put("composition", "composition.json", {"schema": "composition/1", "release": comp, "paper": stats, "meta": {"source": "release manifest (Hugging Face, 2026) and the paper's stats.json"}})
put("bars_sources", "bars_sources.json", {"schema": "bars/1", "unit": "h", "max": None, "rows": [{"label": f"{r['source'].upper() if r['source']!='web' else 'Web corpus'} · {r['n']:,} sequences", "v": r["hours"], "v2": r["drivers"] if r["source"] != "aide" else None, "emph": r["source"] == "baton", "note": "drivers" if r["source"] != "aide" else "2,898 clips"} for r in sorted(comp["by_source"], key=lambda r: -r["hours"])], "meta": {"source": "release manifest · v = hours, v2 = drivers"}})
put("bars_views", "bars_views.json", {"schema": "bars/1", "unit": "sequences", "max": None, "rows": [{"label": k.replace("_", " "), "v": v, "emph": False} for k, v in sorted(comp["views"].items(), key=lambda kv: -kv[1])], "meta": {"source": "release manifest · camera-view types"}})
lb = [("Zero-motion (persistence)", 7.75, .215, False, "reference"), ("GRU", 6.83, .275, False, None), ("siMLPe", 6.85, .227, False, None), ("Transformer ED", 6.75, .282, False, None), ("Transformer + context (enriched)", 6.95, .309, True, "page renders use this run"), ("Transformer-L", 6.63, .287, True, "best MPJPE"), ("Transformer-XL", 6.62, .284, False, None), ("CVAE", 6.84, .257, False, None), ("DDPM", 8.86, .299, False, None), ("AR-LM", 8.16, .458, True, "best F1"), ("Llama-3B", 8.24, .457, False, None)]
put("leaderboard", "leaderboard.json", {"schema": "bars/1", "unit": "", "max": 10, "rows": [{"label": l, "v": v, "v2": f1, "emph": e, "note": nt, "color": "mute" if l.startswith("Zero") else None} for l, v, f1, e, nt in lb], "meta": {"source": "arXiv 2609.08117 v1 · anchored board: MPJPE@4 s (v, lower is better) / Part-State F1@2 s (v2, higher is better)"}})
aide_lbl = comp.get("aide", {}); put("bars_aide", "bars_aide.json", {"schema": "bars/1", "unit": "clips", "rows": [{"label": k, "v": v, "emph": False} for k, v in sorted(aide_lbl.get("behavior", {}).items(), key=lambda kv: -kv[1])], "meta": {"source": "AIDE labels re-attached to the re-extracted sequences"}})

# ---------------------------------------------------------------- sources / numbers / preview / manifest
sources = [
    {"id": "arxiv-abs", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-08", "locator": "Abstract", "quote": "393 hours of 133-keypoint motion sequences at 10 Hz from 360 drivers"},
    {"id": "arxiv-arm", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-08", "locator": "Abstract", "quote": "Arm motion in pre-maneuver windows is 3.4"},
    {"id": "arxiv-gain", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-08", "locator": "Abstract", "quote": "improves forecast-derived Part-State F1 by 44% over the zero-motion reference"},
    {"id": "arxiv-web", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-08", "locator": "Abstract", "quote": "reduces forecasting error on held-out web drivers by 38% compared with BATON-only training"},
    {"id": "hf-card", "kind": "hf-card", "url": HF, "date": TODAY, "locator": "dataset card", "quote": "400 hours of in-cabin driver motion · 360 drivers · 9,010 sequences · 680,082 forecasting windows"},
    {"id": "hf-privacy", "kind": "hf-card", "url": HF, "date": TODAY, "locator": "dataset card", "quote": "privacy-reduced skeleton motion video plus a standardized keypoint tensor"},
    {"id": "hf-license", "kind": "hf-card", "url": HF, "date": TODAY, "locator": "dataset card", "quote": "Skeleton-derived artifacts, annotations, metadata, and code produced by DriveMotion: CC BY 4.0"},
    {"id": "rel-manifest", "kind": "log", "url": None, "date": TODAY, "locator": "release manifest (9,010 sequences)", "quote": f"BATON 1,347 · web 4,765 · AIDE 2,898 · {comp['hours_total']} h"}]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg, on = {}, False
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("drivemotion:"): on = True; continue
    if not line.startswith(" ") and line.strip(): on = False
    if on and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
put("numbers", "numbers.json", {"schema": "numbers/1", "page": "drivemotion", "numbers": reg})
first = sum(f["bytes"] for f in files.values() if f.get("first_view")); total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "drivemotion", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": carry_review(list(items.values()), os.path.join(DATA, "manifest.json"))}
write_json(os.path.join(DATA, "manifest.json"), manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view {first/1e6:.2f} MB")
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
