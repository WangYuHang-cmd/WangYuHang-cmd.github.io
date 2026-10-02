#!/usr/bin/env python3
"""ADAS-TO page exports — SERVER side (openpilot venv: numpy + pandas). Writes site/{data,media} under the scratch dir;
the local adasto_export.py pulls the result, adds figures/GIF→MP4, manifest, sources and the review ledger.

Reads (read-only): labels/cover_takeover_trajectories.npz (6,218 × 11 × 201, −10…+10 s), labels/cover_takeover_input.parquet (trigger),
.hf_staging/_annotations/{clip_final_labels.csv, safety_critical_749.parquet, selection_metrics.parquet}, labels/features.parquet,
labels/_audit_perclip.parquet, three cover clips' CSVs + takeover.mp4 from the sample drivers.
The raw→pseudonym map (.anon/adas_to_id_map.json) is read into RAM only to locate the three clips; nothing raw is written."""
import os, sys, json, glob, re, subprocess
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import write_json, num, nums, resample, b64_i16, b64_u16, h264, fit_cap, poster, lqip, ffprobe, CAPS
ROOT = "/home/henry/Desktop/Drive/ADAS-TO"; OUT = sys.argv[1] if len(sys.argv) > 1 else "/data/datasets/temporary/web_showcase_proj/adasto/site"
DATA, MEDIA = os.path.join(OUT, "data"), os.path.join(OUT, "media"); os.makedirs(DATA, exist_ok=True); os.makedirs(MEDIA, exist_ok=True)
def put(name, obj): n, _ = write_json(os.path.join(DATA, name), obj); print(f"  data  {name:26s} {n/1024:7.1f} KB")

# ---------------------------------------------------------------- trajectories ⋈ trigger
z = np.load(f"{ROOT}/labels/cover_takeover_trajectories.npz", allow_pickle=True)
grid = z["grid"].astype(float); sigs = list(z["sigs"]); traj = z["traj"]; cpaths = [str(p) for p in z["clip_path"]]
inp = pd.read_parquet(f"{ROOT}/labels/cover_takeover_input.parquet").set_index("clip_path")
trig = np.array([inp["trigger"].get(p, "unknown") for p in cpaths])
print("traj", traj.shape, "grid", grid[0], grid[-1], "sigs", sigs); print("triggers", pd.Series(trig).value_counts().to_dict())
assert abs(grid[1] - grid[0] - 0.1) < 1e-6 and len(grid) == 201
STRIP_SIGS = ["vEgo", "aEgo", "ttc", "steer_rate", "lane_dev", "act_brake", "thw", "laneconf"]
GROUPS = [("all", "all cover clips", None, "accent"), ("brake", "brake", "brake", "coral"), ("gas", "gas", "gas", "gold"), ("steering", "steering", "steering", "violet"), ("mixed", "mixed", "mixed", "mint")]
T = traj.copy(); ti = sigs.index("ttc"); T[:, ti, :] = np.where(T[:, ti, :] >= 30, np.nan, T[:, ti, :])  # capped TTC → gap
bands = []
for gid, label, tv, color in GROUPS:
    m = np.ones(len(trig), bool) if tv is None else trig == tv
    for s in STRIP_SIGS:
        a = T[m, sigs.index(s), :]
        with np.errstate(all="ignore"):
            q = {k: np.nanpercentile(a, p, axis=0) for k, p in (("10", 10), ("25", 25), ("50", 50), ("75", 75), ("90", 90))}
        bands.append({"id": f"{gid}:{s}", "group": gid, "col": s, "label": label, "color": color, "n": int(m.sum()), "t": nums(grid, 1), "q": {k: nums(v, 2) for k, v in q.items()}})
put("bands.json", {"schema": "bands/1", "bands": bands, "meta": {"source": "cover-takeover trajectories, release v2 (6,218 clips with complete −10…+10 s kinematics)", "note": "trigger groups brake/gas/steering/mixed; 'none' and 'non_isolatable' clips are in 'all' only", "ttc_cap_s": 30}})

# ---------------------------------------------------------------- hero: 80 raw vEgo traces (20 per trigger) + medians
rng = np.random.default_rng(20260302); series = []
for gid, label, tv, color in GROUPS[1:]:
    idx = np.where(trig == tv)[0]; pick = rng.choice(idx, min(20, len(idx)), replace=False); vi = sigs.index("vEgo")
    for k, i in enumerate(pick): series.append({"id": f"{gid}-{k}", "label": label, "color": color, "style": "line", "alpha": 0.14, "width": 1, "t": nums(grid, 1), "v": nums(traj[i, vi, :], 1)})
    series.append({"id": f"{gid}-median", "label": f"{label} · median", "color": color, "style": "line", "alpha": 1, "width": 2, "t": nums(grid, 1), "v": nums(np.nanmedian(traj[trig == tv, vi, :], axis=0), 1)})
hero = {"schema": "signals/1", "id": "hero_traces", "hz": 10, "n": 201, "t0": -10.0, "duration_s": 20.0, "cols": {"t": nums(grid, 1)}, "labels": {}, "units": {}, "ranges": {}, "series": series,
        "events": [{"t": 0.0, "kind": "takeover", "label": "Takeover (t = 0)", "glyph": "T"}], "shade": [], "bands": [], "fans": [], "thresholds": [], "meta": {"source": "80 raw speed traces (20 per trigger) + per-trigger medians from the cover-takeover trajectories"}}

# ---------------------------------------------------------------- long tail: min TTC vs min THW per cover clip
ti, hi = sigs.index("ttc"), sigs.index("thw")
with np.errstate(all="ignore"):
    min_ttc = np.nanmin(np.where(traj[:, ti, :] > 0, traj[:, ti, :], np.nan), axis=1); min_thw = np.nanmin(np.where(traj[:, hi, :] > 0, traj[:, hi, :], np.nan), axis=1)
ok = np.isfinite(min_ttc) & np.isfinite(min_thw); x = np.clip(min_ttc[ok], 0, 30); y = np.clip(min_thw[ok], 0, 10)
crit = np.where((x < 3) & (y < 0.8), "both", np.where(x < 3, "low TTC (< 3 s)", np.where(y < 0.8, "low THW (< 0.8 s)", "not critical")))
xy = np.stack([np.log10(x + 0.1), np.log10(y + 0.05)], 1)
bb = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
xi = np.round((xy[:, 0] - bb[0]) / (bb[2] - bb[0]) * 64000 - 32000).astype("<i2"); yi = np.round((xy[:, 1] - bb[1]) / (bb[3] - bb[1]) * 64000 - 32000).astype("<i2")
inter = np.empty(2 * len(x), dtype="<i2"); inter[0::2] = xi; inter[1::2] = yi
def dim(labels):
    uniq = ["both", "low TTC (< 3 s)", "low THW (< 0.8 s)", "not critical"] if "both" in set(labels) else sorted(set(labels)); idx = {u: i for i, u in enumerate(uniq)}
    return {"names": uniq, "idx": b64_u16(np.array([idx[l] for l in labels], dtype="<u2"))}
counts = pd.Series(crit).value_counts().to_dict()
put("longtail.json", {"schema": "embedding/1", "n": int(ok.sum()), "bbox": [num(v, 4) for v in bb], "xy_i16": b64_i16(inter), "dims": {"critical": dim(list(crit)), "trigger": dim(list(trig[ok]))}, "reps": [],
    "meta": {"axes": {"x": "min TTC in the clip (s, log scale, capped at 30)", "y": "min THW in the clip (s, log scale, capped at 10)"}, "thresholds": {"ttc_s": 3.0, "thw_s": 0.8}, "counts": counts,
             "source": "cover-takeover trajectories, release v2; clips with a valid lead at some point in the window", "note": "the paper's 285 critical cases were defined on 15,659 clips with the same thresholds (173 low-TTC + 127 low-THW − 15 both)"}})
print("  long tail counts", counts)

# ---------------------------------------------------------------- release composition (pseudonymous annotation table)
C = pd.read_csv(f"{ROOT}/.hf_staging/_annotations/clip_final_labels.csv"); F = pd.read_parquet(f"{ROOT}/labels/features.parquet")
lab = C["final_label"].value_counts(); put("bars_labels.json", {"schema": "bars/1", "unit": "clips", "max": None, "rows": [{"label": {"cover": "cover (brake / steer / gas takeover)", "lane_change": "lane change", "stop": "stop", "turn": "turn", "other": "other", "skip": "skipped"}.get(k, k), "v": int(v), "emph": k == "cover"} for k, v in lab.items()],
                                      "meta": {"source": "release v2 annotation table (16,446 clips)", "human_labeled": int((C["human_labeled"] == "yes").sum())}})
hz = F["log_hz"].value_counts().to_dict(); n_drv = int(C["rel_path"].str.split("/").str[1].nunique()); n_models = int(C["car_model"].nunique()); n_routes = int(C["rel_path"].str.rsplit("/", n=1).str[0].nunique())
comp = {"clips": int(len(C)), "drivers": n_drv, "models": n_models, "routes": n_routes, "log_hz": {str(k): int(v) for k, v in hz.items()}, "speed_pre_mean_kmh": num(F["f_vEgo_pre_mean"].mean() * 3.6, 1),
        "lead_present_frac": num(F["f_lead_present_frac_pre"].mean(), 3) if "f_lead_present_frac_pre" in F else None}
sc = pd.read_parquet(f"{ROOT}/.hf_staging/_annotations/safety_critical_749.parquet"); comp["reviewed_critical"] = int(len(sc)); comp["critical_cols"] = list(sc.columns)[:30]
put("composition.json", {"schema": "composition/1", **comp, "meta": {"source": "release v2 tables"}}); print("  composition", {k: v for k, v in comp.items() if k != "critical_cols"})

# ---------------------------------------------------------------- three cover clips from the sample drivers (pseudonym → raw dir via the id map, RAM only)
idmap_p = f"{ROOT}/.anon/adas_to_id_map.json"; idmap = json.load(open(idmap_p)) if os.path.exists(idmap_p) else {}
def raw_dir(rel):  # rel = CAR/driver_NNN/route_MMM/clip
    car, drv, rt, cid = rel.split("/")
    for kind in ("drivers", "driver", "dongle"):
        pass
    d = idmap.get("driver", idmap.get("drivers", {})); r = idmap.get("route", idmap.get("routes", {}))
    raw_d = d.get(drv) if isinstance(d, dict) else None; raw_r = r.get(f"{drv}/{rt}", r.get(rt)) if isinstance(r, dict) else None
    if raw_d and raw_r: p = f"{ROOT}/dataset/{car}/{raw_d}/{raw_r}/{cid}"; return p if os.path.isdir(p) else None
    return None
if not idmap or raw_dir(C["rel_path"].iloc[0]) is None:  # fall back: features.parquet carries raw paths and (car_model, clip_id, video_time_s) which the HF table shares via clip_id order per route
    print("  id map not usable → joining via features.parquet order")
samp = sorted(set(os.listdir(f"{ROOT}/.hf_staging/_sample_annotations"))) if os.path.isdir(f"{ROOT}/.hf_staging/_sample_annotations") else []
print("  sample annotation files:", samp[:5])
sample_drivers = sorted({m.group(1) for f in samp for m in [re.search(r"(driver_\d+)", f)] if m}) or ["driver_251", "driver_232", "driver_124"]
audit = pd.read_parquet(f"{ROOT}/labels/_audit_perclip.parquet"); print("  audit cols", list(audit.columns)[:20])
cand = C[(C["human_label"] == "cover") & (C["rel_path"].str.split("/").str[1].isin(sample_drivers))].copy()
# raw path per candidate: C.clip_path in hf_staging is pseudonymous; recover the raw path by matching (car_model, clip_id, route order) against features.parquet
F["rel_drv"] = None
raw_by_key = {}
for _, r in F.iterrows(): raw_by_key.setdefault((r["car_model"], int(r["clip_id"]), r["route_id"]), r["clip_path"])
# map pseudonymous route → raw route by pairing sorted route lists per driver (the staging export kept route order); verified below by clip_id sets
def routes_raw_for(car, drv):
    sub = C[(C["car_model"] == car) & (C["rel_path"].str.split("/").str[1] == drv)]; pseudo_routes = sorted(sub["rel_path"].str.split("/").str[2].unique())
    dongles = F[F["car_model"] == car].groupby("dongle_id")["route_id"].apply(lambda s: sorted(set(s)))
    for dng, routes in dongles.items():
        if len(routes) == len(pseudo_routes):
            okk = all(set(sub[sub["rel_path"].str.split("/").str[2] == pr]["clip_id"]) == set(F[(F["dongle_id"] == dng) & (F["route_id"] == rr)]["clip_id"]) for pr, rr in zip(pseudo_routes, routes))
            if okk: return dng, dict(zip(pseudo_routes, routes))
    return None, {}
pool = []  # every usable (rel, raw, trigger, car, driver) among the sample drivers' cover clips
cache = {}
for _, r in cand.iterrows():
    car, drv, rt, cid = r["rel_path"].split("/")
    if (car, drv) not in cache: cache[(car, drv)] = routes_raw_for(car, drv)
    dng, rmap = cache[(car, drv)]
    if not dng or rt not in rmap: continue
    raw = f"{ROOT}/dataset/{car}/{dng}/{rmap[rt]}/{cid}"
    if not os.path.isdir(raw) or not os.path.exists(f"{raw}/takeover.mp4"): continue
    tr = inp["trigger"].get(raw, None); feat = F[F["clip_path"] == raw]
    if tr not in ("brake", "steering", "gas") or feat.empty or feat["f_vEgo_pre_mean"].iloc[0] < 10: continue
    pool.append((r["rel_path"], raw, tr, car, drv))
print("  pool:", len(pool), "clips across", len({p[4] for p in pool}), "drivers")
picked, used_drv = [], set()
for tr in ("brake", "steering", "gas"):  # one clip per trigger, distinct drivers where possible, highest pre-takeover speed first
    opts = sorted([p for p in pool if p[2] == tr], key=lambda p: -float(F[F["clip_path"] == p[1]]["f_vEgo_pre_mean"].iloc[0]))
    best = next((p for p in opts if p[4] not in used_drv), opts[0] if opts else None)
    if best: picked.append(best[:4]); used_drv.add(best[4])
print("  picked clips:", [(p[0], p[2]) for p in picked])
clips_index = []
for k, (rel, raw, tr, car) in enumerate(picked):
    cid = f"clip_{tr}"; meta = json.load(open(f"{raw}/meta.json")); vt = meta["video_time_s"]; cs = meta["clip_start_s"]
    t_new = np.round(np.arange(201) / 10 - 10, 1); cols = {"t": nums(t_new, 1)}
    i = cpaths.index(raw) if raw in cpaths else None
    if i is not None:
        for s in sigs: cols[s] = nums(np.where(traj[i, sigs.index(s), :] >= 30, np.nan, traj[i, sigs.index(s), :]) if s == "ttc" else traj[i, sigs.index(s), :], 3)
    def csv(name): p = f"{raw}/{name}.csv"; return pd.read_csv(p) if os.path.exists(p) else None
    st = csv("carState"); ctl = csv("controlsState"); rad = csv("radarState"); cc = csv("carControl")
    def rs(df, col, kind="linear"):
        if df is None or col not in df: return None
        return resample(df["time_s"].values - vt, pd.to_numeric(df[col], errors="coerce").values, t_new, kind, tol=0.15)
    for name, df, col, kind in (("steer_deg", st, "steeringAngleDeg", "linear"), ("gas_pressed", st, "gasPressed", "nearest"), ("brake_pressed", st, "brakePressed", "nearest"), ("steering_pressed", st, "steeringPressed", "nearest"),
                                ("cc_enabled", st, "cruiseState.enabled", "nearest"), ("op_enabled", ctl, "enabled", "nearest"), ("op_active", ctl, "active", "nearest"), ("lead_d_rel", rad, "leadOne.dRel", "linear"), ("lead_v_rel", rad, "leadOne.vRel", "linear"), ("lat_active", cc, "latActive", "nearest")):
        v = rs(df, col, kind)
        if v is not None: cols[name] = [None if x is None else (int(x > 0.5) if kind == "nearest" else x) for x in v]
    if "vEgo" not in cols and st is not None: cols["vEgo"] = rs(st, "vEgo"); cols["aEgo"] = rs(st, "aEgo")
    events = [{"t": 0.0, "kind": "takeover", "label": f"Takeover · {tr} ({car.replace('_', ' ').title()})", "glyph": "T"}]
    a = audit[audit["clip_path"] == raw] if "clip_path" in audit else audit.iloc[0:0]
    if len(a) and "first_channel" in a and isinstance(a["first_channel"].iloc[0], str) and "t_first" in a and pd.notna(a["t_first"].iloc[0]):
        tf = float(a["t_first"].iloc[0]); tf = tf if -10 <= tf <= 10 else tf - 10.0  # t_first is on the clip clock (0…20 s) in some builds, takeover-relative in others
        if -10 <= tf <= 10: events.insert(0, {"t": num(tf, 1), "kind": "action", "label": f"First driver action: {a['first_channel'].iloc[0]}", "glyph": "A"})
    sig = {"schema": "signals/1", "id": cid, "hz": 10, "n": 201, "t0": -10.0, "duration_s": 20.0, "cols": cols,
           "labels": {"vEgo": "speed", "aEgo": "acceleration", "ttc": "TTC", "thw": "THW", "steer_rate": "steering rate", "lane_dev": "lane deviation", "laneconf": "lane confidence", "act_brake": "brake", "act_gas": "gas", "act_steer": "steer action", "curv_mismatch": "curvature mismatch", "steer_deg": "steering angle", "cc_enabled": "ADAS engaged", "op_enabled": "openpilot enabled", "lead_d_rel": "lead distance", "lead_v_rel": "lead rel. speed"},
           "units": {"vEgo": "m/s", "aEgo": "m/s²", "ttc": "s", "thw": "s", "steer_rate": "deg/s", "lane_dev": "m", "steer_deg": "deg", "lead_d_rel": "m", "lead_v_rel": "m/s"}, "ranges": {"laneconf": [0, 1], "act_brake": [0, 1], "act_gas": [0, 1], "act_steer": [0, 1]}, "caps": {"ttc": 30},
           "shade": [{"col": "cc_enabled", "color": "accent", "alpha": 0.12, "label": "ADAS engaged"}] if "cc_enabled" in cols else [], "events": sorted(events, key=lambda e: e["t"]), "series": [], "bands": [], "fans": [], "thresholds": [{"col": "ttc", "v": 3.0, "label": "TTC 3 s", "color": "coral", "style": "dash"}],
           "media": {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "t0_video_s": 0.0, "aspect": "526/330"},
           "meta": {"vehicle": car.replace("_", " ").title(), "driver": rel.split("/")[1], "trigger": tr, "source": "release-v2 clip (526×330 front camera, 20 s, takeover at 10 s) + openpilot logs at 10 Hz", "log_hz": meta.get("log_hz")}}
    put(f"signals_{cid}.json", sig)
    mp4 = f"{MEDIA}/{cid}.mp4"; jpg = f"{MEDIA}/{cid}.jpg"
    if not os.path.exists(mp4):
        fit_cap(lambda crf, scale: h264(f"{raw}/takeover.mp4", mp4, crf=crf, scale=scale), mp4, 900_000); poster(mp4, jpg, 10.0, q=5)
    pr = ffprobe(mp4); clips_index.append({"id": cid, "title": f"{tr.title()} takeover · {car.replace('_', ' ').title()}", "sub": f"{rel.split('/')[1]} · {meta.get('log_hz')} Hz logs", "src": f"static/data/signals_{cid}.json", "video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "duration_s": num(pr["duration"], 2), "bytes": pr["bytes"]})
    if k == 0: hero["media"] = {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "t0_video_s": 0.0, "aspect": "526/330"}
put("clips.json", {"schema": "clips/1", "default": clips_index[0]["id"] if clips_index else None, "clips": clips_index}); put("hero.json", hero)
print("done", OUT)
