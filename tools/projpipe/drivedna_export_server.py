#!/usr/bin/env python3
"""DriveDNA page exports — SERVER side (openpilot venv). Writes site/{data,media} under the scratch dir.
Reads: figs_making/{final1,final3,final4}/{traces.npz,frame_A.jpg,frame_B.jpg,meta.json} (same-model driver pairs, −8…+8 s),
hf_staging/data/windows.parquet (row-aligned pseudonyms), results/maneuver_audit/{manifest.csv,clips/e*.mp4} (one 10-s road clip per class),
figure PNGs. Raw driver ids in meta.json are mapped to pseudonyms through the window index; nothing raw is written."""
import os, sys, json, subprocess, shutil
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import write_json, num, nums, h264, fit_cap, poster, ffprobe, jpeg_fit, CAPS
ROOT = "/home/henry/Desktop/Drive/DriveDNA"; OUT = sys.argv[1] if len(sys.argv) > 1 else "/data/datasets/temporary/web_showcase_proj/drivedna/site"
DATA, MEDIA = os.path.join(OUT, "data"), os.path.join(OUT, "media"); os.makedirs(DATA, exist_ok=True); os.makedirs(MEDIA, exist_ok=True)
def put(name, obj): n, _ = write_json(os.path.join(DATA, name), obj); print(f"  data  {name:26s} {n/1024:7.1f} KB")
H = pd.read_parquet(f"{ROOT}/hf_staging/data/windows.parquet", columns=["driver", "model_canon", "scenario", "v_mean"])

# ---------------------------------------------------------------- driver pairs (same model, similar scene) as signals/1 per pair, A/B as cols
pairs = []
for kit in ["final1", "final3", "final4"]:
    d = f"{ROOT}/figs_making/{kit}"; j = json.load(open(f"{d}/meta.json")); z = np.load(f"{d}/traces.npz")
    gi = j["gi"]; ps = [H.iloc[g]["driver"] for g in gi]; scen = [H.iloc[g]["scenario"] for g in gi]
    t = np.round(z["A_t"], 1); assert np.allclose(t, np.round(z["B_t"], 1)) and abs(t[1] - t[0] - 0.1) < 1e-6
    sig = {"schema": "signals/1", "id": f"pair_{kit}", "hz": 10, "n": len(t), "t0": float(t[0]), "duration_s": num(len(t) / 10, 1),
           "cols": {"t": nums(t, 1), "v_A": nums(z["A_v"]), "v_B": nums(z["B_v"]), "a_A": nums(z["A_a"]), "a_B": nums(z["B_a"]), "k_A": nums(np.abs(z["A_k"]), 4), "k_B": nums(np.abs(z["B_k"]), 4)},
           "labels": {"v_A": f"speed · {ps[0]}", "v_B": f"speed · {ps[1]}", "a_A": "acceleration · A", "a_B": "acceleration · B", "k_A": "|curvature| · A", "k_B": "|curvature| · B"},
           "units": {"v_A": "m/s", "v_B": "m/s", "a_A": "m/s²", "a_B": "m/s²", "k_A": "1/m", "k_B": "1/m"}, "ranges": {}, "shade": [], "series": [], "bands": [], "fans": [], "thresholds": [],
           "events": [{"t": 0.0, "kind": "anchor", "label": "Curve entry (matched moment)", "glyph": "⌒"}],
           "meta": {"model": j["model"].replace("_", " ").title(), "drivers": ps, "scenario": scen, "scene_similarity": num(j.get("scene_sim"), 3), "contrast": num(j.get("contrast"), 2), "source": "two drivers, same vehicle model, matched road context; 10 Hz CAN kinematics −8…+8 s around the anchor"}}
    put(f"signals_pair_{kit}.json", sig)
    for ab in ("A", "B"):
        src = f"{d}/frame_{ab}.jpg"; dst = f"{MEDIA}/pair_{kit}_{ab}.jpg"; jpeg_fit(src, dst, max_w=526, cap_bytes=45_000, q0=78)
    pairs.append({"id": f"pair_{kit}", "title": f"{j['model'].replace('_', ' ').title()} · {ps[0]} vs {ps[1]}", "sub": f"{scen[0]} · contrast {num(j.get('contrast'), 2)}", "src": f"static/data/signals_pair_{kit}.json", "frames": [f"static/media/pair_{kit}_A.jpg", f"static/media/pair_{kit}_B.jpg"], "drivers": ps, "model": j["model"].replace("_", " ").title()})
put("pairs.json", {"schema": "clips/1", "default": pairs[0]["id"], "clips": pairs})

# ---------------------------------------------------------------- maneuver-audit clips: one road-only 10-s clip per class
m = pd.read_csv(f"{ROOT}/results/maneuver_audit/manifest.csv"); audit = []
for cls in ["lane_change", "decel", "accel", "turn", "curve", "car_following"]:
    for _, r in m[m.cls == cls].iterrows():
        p = f"{ROOT}/results/maneuver_audit/clips/e{r.eid}.mp4"
        if not os.path.exists(p) or H.iloc[int(r.gi)]["v_mean"] < 8: continue
        cid = f"audit_{cls}"; mp4 = f"{MEDIA}/{cid}.mp4"; jpg = f"{MEDIA}/{cid}.jpg"
        fit_cap(lambda crf, scale: h264(p, mp4, crf=crf, scale=scale), mp4, 400_000); poster(mp4, jpg, 5.0, q=5)
        if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=526, cap_bytes=CAPS["poster_bytes"], q0=72)
        pr = ffprobe(mp4); audit.append({"id": cid, "cls": cls, "label": cls.replace("_", " "), "driver": H.iloc[int(r.gi)]["driver"], "model": str(H.iloc[int(r.gi)]["model_canon"]).replace("_", " ").title(), "scenario": H.iloc[int(r.gi)]["scenario"], "video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "duration_s": num(pr["duration"], 2), "bytes": pr["bytes"]})
        break
put("audit_clips.json", {"schema": "clips/1", "default": audit[0]["id"], "clips": [{"id": a["id"], "title": a["label"], "sub": f"{a['model']} · {a['driver']}", "src": None, "video": a["video"], "poster": a["poster"]} for a in audit], "items": audit, "meta": {"source": "maneuver-audit clips (10 s, forward camera, 526×330) — the human-verified maneuver set", "counts": m["cls"].value_counts().to_dict()}})

# ---------------------------------------------------------------- figures
for src, key, w, cap in [(f"{ROOT}/hf_release/assets/teaser.png", "teaser", 2400, 450_000), (f"{ROOT}/figs_making/embedding_map.png", "embedding_map", 2000, 350_000), (f"{ROOT}/figs_making/split_schematic.png", "split_schematic", 2000, 300_000),
                         (f"{ROOT}/figs_making/reveal1_matched_collapse.png", "reveal_matched", 1600, 200_000), (f"{ROOT}/figs_making/reveal2_video_leakage.png", "reveal_leakage", 1600, 200_000), (f"{ROOT}/figs_making/reveal3_identity_vs_prediction.png", "reveal_identity", 1600, 200_000), (f"{ROOT}/figs_making/panelA/lines_overlay.png", "pair_overlay", 1800, 250_000)]:
    if os.path.exists(src): jpeg_fit(src, f"{MEDIA}/fig_{key}.jpg", max_w=w, cap_bytes=cap); print("  fig  ", key, os.path.getsize(f"{MEDIA}/fig_{key}.jpg") // 1024, "KB")
print("done", OUT)
