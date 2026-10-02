#!/usr/bin/env python3
"""Step 1.5 · real-data fixtures for the kit styleguide → assets/proj/fixtures/data/ (git-ignored).
Local sources only (skeleton-only ODMS npz, one consented-recorder BATON route, the user-study tex, three device latency logs);
the DriveDNA embedding is produced on the server by fixtures_server.py and copied here.
Every output passes the privacy gate in common.write_json (no device/route/session ids, no paths)."""
import glob, json, os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import PATHS, write_json, num, nums, signals_from_baton_csv, timeline_from_signals, kpts_from_odms_npz, CABIN_ALLOW, scan_forbidden
D = PATHS["drive"]; OUT = os.path.join(PATHS["repo"], "assets", "proj", "fixtures", "data"); os.makedirs(OUT, exist_ok=True)
def put(name, obj): n, h = write_json(os.path.join(OUT, name), obj); print(f"{name:32s} {n/1024:7.1f} KB"); return h

# ---------------- skeletons (skeleton-only derivatives; no pixels) ----------------
AIDE = os.path.join(D, "explore/opendriver_demo/out/aide_demo"); BAT = os.path.join(D, "explore/opendriver_demo/out/baton_demo")
def aide(sess):
    meta = json.load(open(os.path.join(AIDE, f"meta_{sess}.json")))
    labels = {k.replace("_label", "").replace("driver_", ""): v for k, v in (meta.get("labels") or {}).items()}
    res = meta.get("native_res") or [1920, 1080]
    k = kpts_from_odms_npz(os.path.join(AIDE, f"seq_AIDE_{sess}.npz"), meta={"labels": labels}, seq_id=f"aide_{sess}", part_names=meta.get("parts") or ["head", "face", "torso", "Larm", "Rarm"], aspect=res[0] / res[1])
    k["meta"] = {"source": "AIDE (public benchmark) · RTMW keypoints at 10 Hz · skeleton only", "extractor": meta.get("extractor"), "native_fps": meta.get("native_fps")}
    return k
put("kpts_aide_0829.json", aide("0829")); put("kpts_aide_0001.json", aide("0001"))
bm = json.load(open(os.path.join(BAT, "meta.json"))); z = np.load(os.path.join(BAT, "seq_BATON_HONDA_CIVIC_route0-17.npz"))
can = z["can"]; brake = can[:, 3] > 0.5; steer = np.abs(np.nan_to_num(can[:, 1]))
# best 40 s window (400 frames; 60 s exceeds the 400 KB JSON cap) by brake + steering activity
score = np.convolve(brake.astype(float) * 3 + steer / steer.max(), np.ones(400), "valid"); i0 = int(np.argmax(score)); i0 = min(i0, len(can) - 400)
res = bm.get("native_res") or [1928, 1208]
kb = kpts_from_odms_npz(os.path.join(BAT, "seq_BATON_HONDA_CIVIC_route0-17.npz"), window=(i0, i0 + 400), seq_id="baton_civic_demo", part_names=bm.get("parts"), aspect=res[0] / res[1])
kb["labels"] = {"source": "BATON cabin camera", "vehicle": "Honda Civic"}
kb["meta"] = {"source": "BATON cabin fisheye · RTMW keypoints at 10 Hz · skeleton only (driver not on the cabin allow-list → no pixels)", "window_s": 40, "note": "the gas channel is identically 0 in this sequence; speed/steering/brake shown", "sync_offset_applied_s": bm.get("sync_offset_applied")}
put("kpts_baton_civic.json", kb)

# ---------------- one consented-recorder BATON route window (signals + timeline; no video) ----------------
routes = sorted(glob.glob(os.path.join(D, "BATON", "*", CABIN_ALLOW[0], "*", "route_*")))
assert routes, "no local routes for the allow-listed recorder"
pick = None
for r in routes:  # the scan in the plan found exactly one 100-s window with engage→takeover at speed; recompute to stay deterministic
    vd = os.path.join(r, "vehicle_dynamics.csv")
    if not os.path.exists(vd) or not os.path.exists(os.path.join(r, "driver_state.csv")): continue
    import pyarrow.csv as pc
    t = pc.read_csv(vd, convert_options=pc.ConvertOptions(include_columns=["time_s", "vEgo", "cc_enabled"]))
    ts = t["time_s"].to_numpy(); v = t["vEgo"].to_numpy(); cc = t["cc_enabled"].to_numpy().astype(int)
    rise = ts[1:][(cc[1:] == 1) & (cc[:-1] == 0)]; fall = ts[1:][(cc[1:] == 0) & (cc[:-1] == 1)]
    for rr in rise:
        f = fall[(fall > rr + 5) & (fall < rr + 80)]
        if not len(f): continue
        a = max(0.0, rr - 15); m = (ts >= a) & (ts < a + 100)
        if m.sum() >= 100 and v[m].mean() > 8 and (pick is None or v[m].mean() > pick[0]): pick = (v[m].mean(), r, a)
assert pick, "no engage→takeover window found"
sig = signals_from_baton_csv(pick[1], pick[2], pick[2] + 100, hz=10, clip_id="baton5300_demo")
sig["meta"].update({"source": "lab recorder (consented) · BATON-layout CSVs · 10 Hz", "vehicle": "Tesla Model 3 (openpilot + stock ACC)"})
put("signals_baton5300.json", sig); put("timeline_baton5300.json", timeline_from_signals(sig))

# ---------------- user study (paired/1) from the appendix table ----------------
tex = open(glob.glob(os.path.join(D, "ICLR", "**", "appendix_userstudy.tex"), recursive=True)[0], encoding="utf8").read()
tab = tex[tex.find(r"\label{tab:participants}"):]; tab = tab[:tab.find(r"\end{tabular}")]
rows = []
for line in tab.splitlines():
    m = re.match(r"\s*(P\d\d)\s*&(.*)\\\\", line)
    if not m: continue
    cells = [c.strip() for c in m.group(2).split("&")]
    f = lambda x: None if x in ("--", "-", "") else float(x)
    rows.append({"id": m.group(1), "app_c": f(cells[0]), "app_s": f(cells[1]), "tim_c": f(cells[2]), "tim_s": f(cells[3]), "ann_c": f(cells[4]), "ann_s": f(cells[5]), "pref": cells[6]})
assert len(rows) == 14, len(rows)
def grp(gid, label, a, b, delta, ci, p, cost=False):
    rr = [{"id": r["id"], "a": r[a], "b": r[b]} for r in rows]; n = sum(1 for r in rr if r["a"] is not None and r["b"] is not None)
    return {"id": gid, "label": label, "n": n, "delta": delta, "ci": ci, "p": p, "cost": cost, "rows": rr}
pref = {k: sum(1 for r in rows if r["pref"] == k) for k in ("C", "S", "Equal")}
put("paired_userstudy.json", {"schema": "paired/1", "mode": "slope", "axis": {"min": 1, "max": 7, "label": "construct score (1–7)"}, "from": "openpilot DMS", "to": "TriDrive",
    "groups": [grp("appropriateness", "Appropriateness", "app_s", "app_c", 1.79, [0.86, 2.75], 0.008), grp("timeliness", "Timeliness", "tim_s", "tim_c", 2.67, [1.33, 4.08], 0.008),
               grp("annoyance", "Annoyance (cost)", "ann_s", "ann_c", 1.17, [0.33, 2.08], 0.031, cost=True)],
    "meta": {"preference": {"TriDrive": pref["C"], "openpilot": pref["S"], "equal": pref["Equal"]}, "source": "arXiv 2609.33000 v1 · appendix table of participant-level construct scores", "note": "Δ/CI/p from the paper text; S = openpilot DMS, C = TriDrive"}})

# ---------------- latency (hist/1) from the three largest device logs ----------------
LOGS = sorted(glob.glob(os.path.join(D, "AAAI/Comma_data_backup_sessions/_all_routes/cockpitwm_logs/*/pred_log.jsonl")), key=os.path.getsize, reverse=True)[:3]
groups = []
for gi, lp in enumerate(LOGS, 1):
    e2e, mods = [], {}
    with open(lp, encoding="utf8", errors="replace") as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            v = d.get("e2eLatencyMs")
            if v is None: continue
            e2e.append(float(v))
            for k, mv in (d.get("gpuLatencyMs") or {}).items():
                if isinstance(mv, (int, float)) and k != "badas": mods.setdefault(k, []).append(float(mv))
    x = np.clip(np.array(e2e), 0, 399.99); counts, _ = np.histogram(x, bins=200, range=(0, 400))
    groups.append({"id": f"s{gi}", "label": f"Session {gi}", "counts": counts.tolist(), "p50": num(np.percentile(x, 50), 1), "p95": num(np.percentile(x, 95), 1), "p99": num(np.percentile(x, 99), 1), "n": len(e2e),
                   "modules": {k: {"p50": num(np.percentile(v, 50), 1), "p95": num(np.percentile(v, 95), 1)} for k, v in mods.items()}})
put("hist_latency.json", {"schema": "hist/1", "bin_w": 2, "x0": 0, "unit": "ms", "groups": groups, "lines": [{"v": 300, "label": "300 ms p95 target", "color": "coral"}],
    "meta": {"source": "device logs (pred_log.jsonl) · every tick with an end-to-end latency · three largest sessions", "note": "fixture only; the page export matches the paper's three drives by time-to-first-ready"}})
print("done →", OUT)
