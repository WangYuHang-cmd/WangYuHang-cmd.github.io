#!/usr/bin/env python3
"""Synthetic fixtures for the kit styleguide (kit.html). Every file is clearly meta.synthetic=true.
Exercises each contract in assets/proj/CONTRACTS.md, incl. negative t0, null gaps, caps, bands/fans/series, 133-pt skeleton."""
import json, base64, hashlib, math, os, subprocess
import numpy as np
rng = np.random.default_rng(7)
OUT = os.path.join(os.path.dirname(__file__), "data"); os.makedirs(OUT, exist_ok=True)
SYN = {"synthetic": True, "note": "synthetic fixture for the kit styleguide; not research data"}
def b64(a): return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode("ascii")
def num(v, dp=3):
    if v is None or (isinstance(v, float) and not math.isfinite(v)): return None
    return round(float(v), dp)
def write(name, obj):
    p = os.path.join(OUT, name); s = json.dumps(obj, separators=(",", ":"), ensure_ascii=False); open(p, "w").write(s); return p, len(s), hashlib.sha256(s.encode()).hexdigest()
files = {}
def reg(key, name, obj):
    p, n, h = write(name, obj); files[key] = {"path": "data/" + name, "sha256": h, "bytes": n}; print(f"{name:34s} {n/1024:7.1f} KB")

# ---------- signals A: clock −10…+10 s (ADAS-TO-like) with bands, fans, series, thresholds, caps, shade ----------
hz, n = 10, 200
t = np.round(-10 + np.arange(n) / hz, 3)
v = 25 + 4 * np.sin(t / 3) - 6 * np.clip(t, 0, None) / 10
steer = 8 * np.sin(t / 1.5) * (t > -4)
risk = np.clip(0.15 + 0.6 / (1 + np.exp(-(t + 1.5) * 2)) + rng.normal(0, .02, n), 0, 1)
ttc = 40 - 3.2 * (t + 10); ttc_col = [None if x >= 30 else num(x, 2) for x in ttc]
cc = ((t > -8) & (t < 2.3)).astype(int); dis = ((t > -3) & (t < 1)).astype(int)
lcs = np.where((t > 3) & (t < 4.5), 1, np.where((t >= 4.5) & (t < 6), 2, np.where((t >= 6) & (t < 7), 3, 0)))
gap = (t > 7.5) & (t < 8.4)
sigA = {"schema": "signals/1", "id": "synth_a", "hz": hz, "n": n, "t0": float(t[0]), "duration_s": 20.0,
  "cols": {"t": [num(x, 2) for x in t], "v_ego_mps": [None if g else num(x) for x, g in zip(v, gap)], "steer_deg": [num(x) for x in steer],
           "risk": [num(x) for x in risk], "ttc_s": ttc_col, "cc_enabled": cc.tolist(), "is_distracted": dis.tolist(), "lane_change_state": lcs.tolist()},
  "labels": {"v_ego_mps": "speed", "steer_deg": "steering", "risk": "risk", "ttc_s": "TTC", "cc_enabled": "automation", "is_distracted": "DMS distraction", "lane_change_state": "lane change"},
  "units": {"v_ego_mps": "m/s", "steer_deg": "deg", "ttc_s": "s"}, "ranges": {"risk": [0, 1]}, "caps": {"ttc_s": 30},
  "codes": {"lane_change_state": {"0": "off", "1": "pre", "2": "starting", "3": "finishing"}},
  "shade": [{"col": "cc_enabled", "color": "accent", "alpha": 0.12, "label": "automation engaged"}],
  "events": [{"t": 0.0, "kind": "takeover", "label": "Takeover (t = 0)", "glyph": "T"}, {"t": -3.0, "kind": "onset", "label": "Distraction onset", "glyph": "!"}, {"t": 4.5, "kind": "lane_change", "label": "Lane change starting", "glyph": "⇄"}],
  "series": [{"id": "wm", "label": "window score", "unit": "", "color": "accent", "style": "step", "window_s": 2.0,
              "t": [num(x, 1) for x in np.arange(-8, 10.1, .5)], "v": [num(x) for x in np.clip(.1 + .5 / (1 + np.exp(-(np.arange(-8, 10.1, .5) + 1) * 1.5)) + rng.normal(0, .03, len(np.arange(-8, 10.1, .5))), 0, 1)]}],
  "bands": [], "fans": [], "thresholds": [{"col": "risk", "v": 0.5, "label": "illustrative threshold", "color": "coral", "style": "dash"}], "meta": dict(SYN)}
bt = np.round(np.arange(-10, 10.01, .2), 2)
for bid, lab, nn, drop, col in [("brake", "brake", 1033, 9, "accent"), ("gas", "gas", 789, 3, "violet"), ("steering", "steering", 576, 6, "gold")]:
    med = 26 - drop * np.clip(bt, 0, None) / 10 + 2 * np.sin(bt / 4)
    q = {"10": med - 7, "25": med - 3.5, "50": med, "75": med + 3.5, "90": med + 7}
    sigA["bands"].append({"id": bid, "label": lab, "color": col, "n": nn, "t": bt.tolist(), "q": {k: [num(x, 2) for x in vv] for k, vv in q.items()}})
p = np.clip(np.linspace(.2, .85, 25) + rng.normal(0, .02, 25), 0, 1)
sigA["fans"] = [{"id": "onset", "label": "forecast at onset", "anchor_t": -3.0, "step_s": .2, "horizon_s": 5.0, "p": [num(x) for x in p], "contrib": {"dis": [num(x) for x in p * .5], "gaze": [num(x) for x in p * .3], "hands": [num(x) for x in p * .2]}},
               {"id": "pre", "label": "forecast 1.5 s before", "anchor_t": -4.5, "step_s": .2, "horizon_s": 5.0, "p": [num(x) for x in p * .6], "contrib": {"dis": [num(x) for x in p * .3], "gaze": [num(x) for x in p * .2], "hands": [num(x) for x in p * .1]}}]
reg("signals_a", "synth_signals_layers.json", sigA)

# ---------- signals B/C: 0…20 s clips with a test-pattern video (video clock path) ----------
def clipsig(cid, phase):
    hz, n = 10, 200; t = np.round(np.arange(n) / hz, 2)
    v = 20 + 5 * np.sin(t / 2 + phase); risk = np.clip(.2 + .5 * (np.sin(t / 3 + phase) > .3) + rng.normal(0, .03, n), 0, 1)
    cc = ((t > 2) & (t < 15)).astype(int); dis = ((t > 8) & (t < 11)).astype(int)
    return {"schema": "signals/1", "id": cid, "hz": hz, "n": n, "t0": 0.0, "duration_s": 20.0,
      "cols": {"t": t.tolist(), "v_ego_mps": [num(x) for x in v], "risk": [num(x) for x in risk], "cc_enabled": cc.tolist(), "is_distracted": dis.tolist(),
               "pi_dis": [num(x) for x in np.clip(risk * .6, 0, 1)], "pi_gaze": [num(x) for x in np.clip(risk * .3, 0, 1)], "pi_hands": [num(x) for x in np.clip(risk * .1, 0, 1)]},
      "labels": {"v_ego_mps": "speed", "risk": "risk", "cc_enabled": "automation", "is_distracted": "DMS distraction"}, "units": {"v_ego_mps": "m/s"}, "ranges": {"risk": [0, 1]},
      "shade": [{"col": "cc_enabled", "color": "accent", "alpha": .12, "label": "automation engaged"}],
      "events": [{"t": 8.0, "kind": "onset", "label": "Distraction onset", "glyph": "!"}, {"t": 15.0, "kind": "disengage", "label": "Automation off", "glyph": "−"}],
      "thresholds": [{"col": "risk", "v": .5, "label": "illustrative threshold", "color": "coral", "style": "dash"}],
      "media": {"video": "data/synth_clip.mp4", "poster": "data/synth_clip.jpg", "t0_video_s": 0.0, "aspect": "526/330"}, "meta": dict(SYN)}
reg("signals_b", "synth_signals_b.json", clipsig("synth_b", 0)); reg("signals_c", "synth_signals_c.json", clipsig("synth_c", 1.3))
write("synth_clips.json", {"schema": "clips/1", "default": "b", "clips": [{"id": "b", "title": "Clip B", "sub": "synthetic", "src": "data/synth_signals_b.json", "video": "data/synth_clip.mp4", "poster": "data/synth_clip.jpg"},
                                                   {"id": "c", "title": "Clip C", "sub": "synthetic", "src": "data/synth_signals_c.json", "video": "data/synth_clip.mp4", "poster": "data/synth_clip.jpg"}]})
mp4 = os.path.join(OUT, "synth_clip.mp4")
if not os.path.exists(mp4):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=526x330:rate=20", "-t", "20", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-crf", "30", "-movflags", "+faststart", "-an", mp4], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "8", "-i", mp4, "-frames:v", "1", "-q:v", "5", os.path.join(OUT, "synth_clip.jpg")], check=True)
print("synth_clip.mp4", os.path.getsize(mp4) // 1024, "KB")

# ---------- timeline ----------
reg("timeline", "synth_timeline.json", {"schema": "timeline/1", "span": [0, 20.0], "lanes": [
  {"id": "engaged", "label": "automation", "segs": [[0, 2, "off"], [2, 15, "on"], [15, 20, "off"]], "marks": [{"t": 2.0, "kind": "handover", "label": "Handover ↑"}, {"t": 15.0, "kind": "takeover", "label": "Takeover ↓"}]},
  {"id": "dms", "label": "DMS", "segs": [[0, 8, "off"], [8, 11, "on"], [11, 20, "off"]], "marks": [{"t": 8.0, "kind": "alert", "label": "Distraction"}]}], "meta": dict(SYN)})

# ---------- embedding: 3 blobs, 3000 points ----------
N = 3000; centers = np.array([[-2, 0], [2, 1], [0, -2.5]]); lab_s = rng.integers(0, 3, N)
xy = centers[lab_s] + rng.normal(0, .7, (N, 2)); drivers = rng.integers(0, 30, N); models = (drivers % 5)
bb = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
xi = np.round((xy[:, 0] - bb[0]) / (bb[2] - bb[0]) * 64000 - 32000).astype(np.int16); yi = np.round((xy[:, 1] - bb[1]) / (bb[3] - bb[1]) * 64000 - 32000).astype(np.int16)
inter = np.empty(2 * N, dtype=np.int16); inter[0::2] = xi; inter[1::2] = yi
reps = []
for d in [3, 11, 17, 24]:
    idx = np.where(drivers == d)[0]; m = xy[idx].mean(0); i = int(idx[np.argmin(((xy[idx] - m) ** 2).sum(1))])
    reps.append({"dim": "driver", "name": f"driver_{d:03d}", "label": f"driver_{d:03d} · model_{d % 5} · {len(idx)} windows", "i": i})
reg("embedding", "synth_embedding.json", {"schema": "embedding/1", "n": N, "bbox": [num(x, 4) for x in bb], "xy_i16": b64(inter),
  "dims": {"driver": {"names": [f"driver_{i:03d}" for i in range(30)], "idx": b64(drivers.astype(np.uint16))},
           "model": {"names": [f"model_{i}" for i in range(5)], "idx": b64(models.astype(np.uint16))},
           "scenario": {"names": ["highway", "urban", "rural"], "idx": b64(lab_s.astype(np.uint16))}},
  "reps": reps, "purity": {"k": 10, "driver": .21, "model": .48, "scenario": .93}, "meta": dict(SYN)})

# ---------- kpts: 133-point stick figure, 12 s @ 10 Hz, aspect 1.596 ----------
n, K = 120, 133; tt = np.arange(n) / 10
base = {0: (.50, .30), 1: (.49, .29), 2: (.51, .29), 3: (.47, .30), 4: (.53, .30), 5: (.42, .42), 6: (.58, .42), 7: (.37, .55), 8: (.63, .55), 9: (.40, .66), 10: (.60, .66), 11: (.45, .72), 12: (.55, .72), 13: (.44, .90), 14: (.56, .90), 15: (.44, 1.05), 16: (.56, 1.05)}
X = np.full((n, K), np.nan); Y = np.full((n, K), np.nan); S = np.zeros((n, K), dtype=np.uint8)
for f in range(n):
    sway = .02 * math.sin(tt[f] * 1.2); reach = .08 * max(0, math.sin(tt[f] * .9)) ** 2
    for j, (x, y) in base.items():
        dx = sway + (reach if j in (8, 10) else 0); dy = -(reach * .6) if j in (8, 10) else 0
        X[f, j] = x + dx; Y[f, j] = y + dy; S[f, j] = int(rng.integers(170, 255))
    for j in range(17, 23): X[f, j] = X[f, 15 if j < 20 else 16] + .01 * (j % 3); Y[f, j] = Y[f, 15 if j < 20 else 16] + .03; S[f, j] = 120
    for k in range(68): a = -math.pi * .1 + math.pi * 1.2 * k / 67; X[f, 23 + k] = X[f, 0] + .045 * math.cos(a); Y[f, 23 + k] = Y[f, 0] - .01 + .06 * math.sin(a) ** 2 * (1 if k < 17 else .5); S[f, 23 + k] = 200
    for hand, w in ((91, 9), (112, 10)):
        if hand == 91 and 40 <= f < 60: continue  # left hand lost for 2 s
        for k in range(21): fi = (k - 1) // 4; X[f, hand + k] = X[f, w] + (.012 * (k % 4 + 1)) * math.cos(.6 + fi * .35) * (1 if hand == 112 else -1); Y[f, hand + k] = Y[f, w] + .012 * (k % 4 + 1) * math.sin(.6 + fi * .35) * .5 + .01; S[f, hand + k] = int(rng.integers(90, 240))
# tracker jump at frame 75 (masked)
S[75, :] = 0
valid = S > 0; sc = 10000
kx = np.where(valid, X, 0); ky = np.where(valid, Y, 0)
inter = np.empty(n * K * 2, dtype=np.int16); inter[0::2] = np.round(kx.ravel() * sc); inter[1::2] = np.round(ky.ravel() * sc)
vx = X[valid]; vy = Y[valid]; x0, x1 = np.percentile(vx, [1, 99]); y0, y1 = np.percentile(vy, [1, 99]); mx, my = (x1 - x0) * .15, (y1 - y0) * .15
pv = np.stack([valid[:, 23:91].any(1), valid[:, :17].any(1), valid[:, 91:112].any(1), valid[:, 112:133].any(1), valid[:, 17:20].any(1), valid[:, 20:23].any(1)], 1).astype(np.uint8)
reg("kpts", "synth_kpts.json", {"schema": "kpts/1", "id": "synth_pose", "hz": 10, "n": n, "K": K, "kpt_set": "wholebody_133", "enc": "b64le-int16", "scale": sc, "kpts": b64(inter), "score": b64(S.ravel()),
  "head": {"yaw": [num(.5 * math.sin(x * .8)) for x in tt], "pitch": [num(.2 * math.sin(x * 1.7)) for x in tt], "roll": [0.0] * n},
  "can": {"t": [num(x, 1) for x in tt], "v_ego_mps": [num(12 + 3 * math.sin(x / 2)) for x in tt], "steer_deg": [num(20 * math.sin(x / 1.7)) for x in tt], "gas": [int(x % 4 < 1) for x in tt], "brake": [int(6 < x < 7.5) for x in tt]},
  "part_valid": {"names": ["face", "body", "lhand", "rhand", "lfoot", "rfoot"], "v": b64(pv.ravel())}, "aspect": 1.596,
  "crop": [num(x0 - mx, 4), num(y0 - my, 4), num(x1 + mx, 4), num(y1 + my, 4)], "filtered_frames": [75], "labels": {"behavior": "Body Movement", "emotion": "Weariness", "scene": "Smooth Traffic"}, "meta": dict(SYN)})

# ---------- paired ----------
rows = []
for i in range(14):
    a = int(rng.integers(2, 6)); b = min(7, a + int(rng.integers(0, 4))); rows.append({"id": f"P{i+1:02d}", "a": a, "b": b})
rows[4]["a"] = None; rows[9]["b"] = None
reg("paired_slope", "synth_paired_slope.json", {"schema": "paired/1", "mode": "slope", "axis": {"min": 1, "max": 7, "label": "rating (1–7)"}, "from": "baseline", "to": "ours",
  "groups": [{"id": "appropriateness", "label": "Appropriateness", "n": 12, "delta": 1.79, "ci": [.86, 2.75], "p": .008, "rows": rows},
             {"id": "annoyance", "label": "Annoyance (cost)", "n": 12, "delta": 1.17, "ci": [.33, 2.08], "p": .031, "cost": True, "rows": [{"id": r["id"], "a": r["a"], "b": (None if r["b"] is None else max(1, r["b"] - 2))} for r in rows]}], "meta": dict(SYN)})
reg("paired_dumbbell", "synth_paired_dumbbell.json", {"schema": "paired/1", "mode": "dumbbell", "axis": {"min": .5, "max": 1.0, "label": "AUROC", "chance": .5}, "from": "unseen drivers", "to": "matched context",
  "groups": [{"id": "ladder", "label": "Leakage ladder", "rows": [
    {"id": "desc", "label": "Descriptors", "a": .707, "b": .550, "emph": True}, {"id": "qwen", "label": "Qwen3-4B", "a": .596, "b": .551, "emph": False}, {"id": "moment", "label": "MOMENT-1", "a": .636, "b": .596, "emph": False},
    {"id": "video", "label": "Video-only probe", "a": .937, "b": .675, "emph": True}, {"id": "clip", "label": "CLIP-aligned CAN", "a": .831, "b": .683, "emph": False}, {"id": "jepa", "label": "JEPA-style SSL", "a": .878, "b": .735, "emph": False},
    {"id": "masked", "label": "Masked-TS SSL", "a": .907, "b": .740, "emph": True}, {"id": "patch", "label": "PatchTST + SupCon", "a": .935, "b": .811, "emph": True}], "note": "balanced window pairs matched on model, scenario and speed"}], "meta": dict(SYN)})

# ---------- bars (real DriveMotion leaderboard numbers, used only as shape test here) ----------
lb = [("zero-motion", 7.75, .215, False, "persistence"), ("GRU", 6.83, .275, False, None), ("siMLPe", 6.85, .227, False, None), ("Transformer ED", 6.75, .282, False, None), ("Transformer +ctx", 6.95, .309, True, "enriched"),
      ("Transformer-L", 6.63, .287, False, None), ("Transformer-XL", 6.62, .284, False, None), ("CVAE", 6.84, .257, False, None), ("DDPM", 8.86, .299, False, None), ("AR-LM", 8.16, .458, False, None), ("Llama-3B", 8.24, .457, False, None)]
reg("bars", "synth_bars.json", {"schema": "bars/1", "unit": "", "max": 10, "rows": [{"label": l, "v": v, "v2": v2, "emph": e, "note": nt, "color": "mute" if l == "zero-motion" else None} for l, v, v2, e, nt in lb], "meta": {"synthetic": False, "note": "numbers from the DriveMotion arXiv v1 Table (MPJPE@4s / F1@2s); layout test"}})

# ---------- hist ----------
groups = []
for gid, lab, mu, sd, ref in [("s1", "Drive 1", 85, 18, (83, 153)), ("s2", "Drive 2", 140, 30, (138, 239)), ("s3", "Drive 3", 136, 14, (135, 177))]:
    x = np.clip(rng.gamma((mu / sd) ** 2, sd ** 2 / mu, 6000), 0, 399); counts, _ = np.histogram(x, bins=200, range=(0, 400))
    groups.append({"id": gid, "label": lab, "counts": counts.tolist(), "p50": num(np.percentile(x, 50), 1), "p95": num(np.percentile(x, 95), 1), "n": 6000, "ref": {"p50": ref[0], "p95": ref[1], "label": "paper"}})
reg("hist", "synth_hist.json", {"schema": "hist/1", "bin_w": 2, "x0": 0, "unit": "ms", "groups": groups, "lines": [{"v": 300, "label": "300 ms p95 target", "color": "coral"}], "meta": dict(SYN)})

# ---------- sources ----------
reg("sources", "synth_sources.json", {"schema": "sources/1", "sources": [
  {"id": "arxiv-demo", "kind": "arxiv", "url": "https://arxiv.org/abs/2609.33000v1", "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "48.05 versus 71.47 All-MPJPE"},
  {"id": "hf-demo", "kind": "hf-card", "url": "https://huggingface.co/HenryYHW/TriDrive", "date": "2026-10-02", "locator": "README", "quote": "CC BY-SA 4.0"},
  {"id": "log-demo", "kind": "log", "url": None, "date": "2026-10-02", "locator": "pred_log.jsonl × 50 sessions", "quote": "p95 152.6 ms"}]})

write("synth_manifest.json", {"schema": "manifest/1", "page": "kit", "generated": "2026-10-02", "pipeline_version": "synth", "budget": {"first_view_bytes": 3000000, "total_media_bytes": 25000000, "used_first_view": 0, "used_total": 0}, "files": files, "items": []})
print("manifest keys:", ", ".join(files))
