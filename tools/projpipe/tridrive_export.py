#!/usr/bin/env python3
"""TriDrive page exports (local machine only) → tridrive/static/{data,media}.

Sources (read-only): the consented-recorder examples in AAAI/Paper/figs/teaser_making/examples (signals.csv, forecast*.csv),
annotation clip indexes + 640×400 cab/road clips under AAAI/Explore/s15_cockpit, the BATON-layout route CSVs under Drive/BATON,
the device logs (pred_log.jsonl), the ICLR tex/figures and the supplementary build PNGs.
Every output passes the privacy gate (common.write_json / validate.py). Cabin pixels are exported ONLY for the allow-listed
recorder (checked here against the uid, stored as a boolean). Usage: tridrive_export.py [--force] [--skip-media]"""
import argparse, glob, json, os, re, shutil, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (PATHS, CAPS, CABIN_ALLOW, write_json, num, nums, resample, read_csv, first_col, signals_from_baton_csv, hstack, fit_cap, poster, lqip, jpeg_fit, ffprobe, sha256_file, entry_hash, Ledger)

D = PATHS["drive"]; REPO = PATHS["repo"]; PAGE = os.path.join(REPO, "tridrive"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media")
WORK = os.path.join(PATHS["work"], "tridrive"); os.makedirs(DATA, exist_ok=True); os.makedirs(MEDIA, exist_ok=True); os.makedirs(WORK, exist_ok=True)
EXDIR = os.path.join(D, "AAAI/Paper/figs/teaser_making/examples"); S15 = os.path.join(D, "AAAI/Explore/s15_cockpit"); LOGS = os.path.join(D, "AAAI/Comma_data_backup_sessions/_all_routes/cockpitwm_logs")
ARXIV = "https://arxiv.org/abs/2609.33000v1"; TODAY = "2026-10-02"
ap = argparse.ArgumentParser(); ap.add_argument("--force", action="store_true"); ap.add_argument("--skip-media", action="store_true"); A = ap.parse_args()
files, items = {}, []
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:28s} {n/1024:7.1f} KB"); return p
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}

# ====================================================================== 1. clips: five phone examples (v1 clips ≥ 11 s) + controls (v2, 15 s)
EXAMPLES = ["ex01_ep65", "ex02_ep67", "ex04_ep1092", "ex05_ep1645", "ex14_ep2824"]  # all on the allow-listed recorder; v1 clip ≥ 11 s
eps_v1 = json.load(open(os.path.join(S15, "annotate_episodes.json")))
ann_v2 = json.load(open(os.path.join(S15, "annotations_v2.json"))); eps_v2 = json.load(open(os.path.join(S15, "annotate_episodes_v2.json")))
by_uid_t0 = {}
for e in eps_v2: by_uid_t0.setdefault((e["uid"], round(e["t0"], 1)), e)
def route_dir(uid): return os.path.join(D, "BATON", *uid.split("__"))
def clip_label(uid, t0):
    a = [v for v in ann_v2.values() if v.get("uid") == uid and abs(v.get("t0", -1) - t0) < 0.11]
    return (a[0].get("label"), a[0].get("alert_type")) if a else (None, None)
def example_spec(ex):
    m = open(os.path.join(EXDIR, ex, "meta.txt"), encoding="utf8").read(); n = int(re.search(r"episode #(\d+)", m).group(1)); uid = re.search(r"uid: (\S+)", m).group(1)
    t0 = float(re.search(r"t0=([\d.]+)", m).group(1)); dongle = re.search(r"dongle: (\w+)", m).group(1); ep = eps_v1[n - 1]
    assert ep["uid"] == uid and abs(ep["t0"] - t0) < 0.01, ex
    allow = dongle in CABIN_ALLOW; assert allow, f"{ex} is not on the allow-list"
    cab = os.path.join(S15, "annotate_clips", f"{n-1:03d}_cab.mp4"); road = cab.replace("_cab", "_road"); L = ffprobe(cab)["duration"]
    return {"id": f"ex{ex[2:4]}", "src_dir": os.path.join(EXDIR, ex), "uid": uid, "t0": t0, "cab": cab, "road": road, "L": L, "kind": "phone", "label": "phone pickup", "allow": allow, "has_forecast": True}
def control_specs():
    out = []
    for key, a in ann_v2.items():
        if a.get("label") != "warranted" or CABIN_ALLOW[0] not in a.get("uid", ""): continue
        e = by_uid_t0.get((a["uid"], round(a["t0"], 1)))
        if not e or e.get("v_mean", 0) <= 10: continue
        cab = os.path.join(S15, "annotate_clips_v2", f"{e['idx']:05d}_cab.mp4")
        if not os.path.exists(cab) or a.get("alert_type") not in ("hands", "attention", "drowsy", "mirror"): continue
        out.append({"id": f"ctl_{a['alert_type']}_{e['idx']}", "src_dir": None, "uid": a["uid"], "t0": a["t0"], "cab": cab, "road": cab.replace("_cab", "_road"), "L": ffprobe(cab)["duration"], "kind": a["alert_type"],
                    "label": {"hands": "hands off the wheel", "attention": "attention off the road", "drowsy": "drowsiness", "mirror": "mirror / dash glance"}[a["alert_type"]], "allow": True, "has_forecast": False, "regime": e.get("regime")})
    picked, seen = [], set()
    for c in sorted(out, key=lambda c: (c["kind"], -c["L"])):
        if c["kind"] in seen: continue
        seen.add(c["kind"]); picked.append(c)
    return picked[:2]
specs = [example_spec(e) for e in EXAMPLES] + control_specs()
ledger = Ledger(os.path.join(WORK, "ledger.jsonl")).load(); clips_index = []
for i, s in enumerate(specs):
    cid = s["id"]; T_A = s["t0"] - 5.0; T_B = T_A + s["L"]; print(f"clip {cid}: {s['kind']} · {s['L']:.0f} s")
    sig = signals_from_baton_csv(route_dir(s["uid"]), T_A, T_B, hz=10, clip_id=cid)
    n = sig["n"]; t_new = np.arange(n) / 10
    if s["has_forecast"]:
        sc = read_csv(os.path.join(s["src_dir"], "signals.csv")); ts = sc["t"] + 5.0  # signals.csv t is relative to the onset; clip time puts the onset at 5 s
        sig["cols"]["risk"] = resample(ts, sc["badas_risk"], t_new, "linear", tol=.15); ttc = resample(ts, sc["ttc"], t_new, "linear", tol=.15)
        sig["cols"]["ttc_s"] = [None if (v is None or v >= 29.99) else v for v in ttc]; sig["caps"] = {"ttc_s": 30}
        sig["labels"].update({"risk": "risk (CockpitWM)", "ttc_s": "TTC"}); sig["units"]["ttc_s"] = "s"; sig["ranges"]["risk"] = [0, 1]
        sig["thresholds"] = [{"col": "risk", "v": 0.5, "label": "illustrative threshold", "color": "coral", "style": "dash"}]
        for fid, fname, anchor, lab in (("onset", "forecast.csv", 5.0, "forecast at onset"), ("pre", "forecast_pre.csv", 3.5, "forecast 1.5 s before")):
            fp = os.path.join(s["src_dir"], fname)
            if not os.path.exists(fp): continue
            fc = read_csv(fp); p = fc["p_warn_cum"][:25]
            sig["fans"].append({"id": fid, "label": lab, "anchor_t": anchor, "step_s": 0.2, "horizon_s": 5.0, "p": nums(p), "contrib": {"dis": nums(fc["pi_dis"][:25]), "gaze": nums(fc["pi_gaze"][:25]), "hands": nums(fc["pi_hands"][:25])}})
        early = os.path.join(s["src_dir"], "forecast_early.csv")
        sig["meta"]["forecast_at_anchor"] = {k: num(read_csv(os.path.join(s["src_dir"], f))["p_warn_cum"][24]) for k, f in (("onset", "forecast.csv"), ("pre", "forecast_pre.csv"), ("early", "forecast_early.csv")) if os.path.exists(os.path.join(s["src_dir"], f))}
        sig["meta"]["forecast_provenance"] = {"model": "CockpitWM chain models (pre-TriDrive iteration)", "role": "illustrative", "paper": "arXiv 2609.33000 §Limitation"}
    sig["events"] = [e for e in sig["events"] if e["kind"] != "distracted"] + [{"t": 5.0, "kind": "onset", "label": f"Annotated onset: {s['label']}", "glyph": "!"}]
    sig["events"].sort(key=lambda e: e["t"]); sig["id"] = cid
    sig["media"] = {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "t0_video_s": 0.0, "aspect": "960/300"}
    sig["meta"].update({"recorder": "lab-owned, consented", "annotation": f"warranted · {s['kind']}", "source": "annotation clip (cab | road, 640×400 each) + route CSVs at 10 Hz"})
    put(f"signals_{cid}", f"signals_{cid}.json", sig, first_view=(i == 0))
    # media
    h = entry_hash({"id": cid, "L": s["L"], "T_A": T_A}, s["cab"], s["road"]); mp4 = os.path.join(MEDIA, f"{cid}.mp4"); jpg = os.path.join(MEDIA, f"{cid}.jpg")
    if not A.skip_media and (A.force or not ledger.done(cid, h) or not os.path.exists(mp4)):
        crf, scale = fit_cap(lambda crf, scale: hstack(s["cab"], s["road"], mp4, crf=crf, height=300 if not scale else 240), mp4, 900_000)  # 960×300: plates on the road half are not legible
        poster(mp4, jpg, 5.0, q=5)
        if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=1280, cap_bytes=CAPS["poster_bytes"], q0=70)
        ledger.mark(cid, h, crf=crf, scale=scale)
    if os.path.exists(mp4):
        pr = ffprobe(mp4); assert abs(pr["duration"] - s["L"]) < 0.25, (cid, pr["duration"], s["L"])
        items.append({"id": cid, "kind": "clip", "title": f"{s['label']} · {s['L']:.0f} s", "files": {"video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg", "signals": f"static/data/signals_{cid}.json"},
                      "bytes": {"video": os.path.getsize(mp4), "poster": os.path.getsize(jpg)}, "first_view": i == 0, "duration_s": num(pr["duration"], 2), "key_moment": {"t": 5.0, "label": "onset"}, "poster_lqip": lqip(jpg),
                      "privacy": {"kind": "cabin_allowlisted", "allowlisted": True, "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "lab recorder; consented driver; cab|road annotation clip downscaled to 960×300 (plates not legible)"},
                      "provenance": {"source": os.path.basename(s["cab"]).replace(".mp4", "") + " (+road)", "recorder": "lab-owned, consented", "video": {"crf": ledger.rows.get(cid, {}).get("crf"), "codec": pr["codec"], "fps": pr["fps"]}}, "entry_hash": h})
        files[f"media_{cid}"] = media_entry(f"{cid}.mp4"); files[f"poster_{cid}"] = media_entry(f"{cid}.jpg")
    fa = sig["meta"].get("forecast_at_anchor") or {}
    clips_index.append({"id": cid, "title": {"phone": "Phone pickup", "hands": "Hands off", "attention": "Attention off road", "drowsy": "Drowsy", "mirror": "Mirror glance"}.get(s["kind"], s["kind"]) + f" · {s['L']:.0f} s",
                        "sub": ("fan: p(warn) at +5 s " + " · ".join(f"{k} {v:.2f}" for k, v in fa.items())) if fa else "control clip · DMS + vehicle signals only",
                        "src": f"static/data/signals_{cid}.json", "video": f"static/media/{cid}.mp4", "poster": f"static/media/{cid}.jpg"})
put("clips", "clips.json", {"schema": "clips/1", "default": specs[0]["id"], "clips": clips_index}, first_view=True)

# ====================================================================== 2. latency (hist/1): the paper's three drives matched by time-to-first-ready, over the paper's windows
PAPER = [("drive-1", 80.4, 1347, 83, 153), ("drive-2", 84.2, 1450, 138, 239), ("drive-3", 50.8, 2453, 135, 177)]
sessions = []
for lp in sorted(glob.glob(os.path.join(LOGS, "*/pred_log.jsonl"))):
    t_first = t_ready = None; ticks = []
    with open(lp, errors="replace") as fh:
        for line in fh:
            try: d = json.loads(line)
            except Exception: continue
            t = d.get("t")
            if t is None: continue
            if t_first is None: t_first = t
            if t_ready is None and d.get("ready"): t_ready = t
            v = d.get("e2eLatencyMs")
            if v is None: continue
            ticks.append((t - t_first, float(v), {k: float(mv) for k, mv in (d.get("gpuLatencyMs") or {}).items() if isinstance(mv, (int, float)) and k != "badas"}, d.get("effectiveSource"), d.get("fallbackReason"), bool(d.get("ready"))))
    if ticks: sessions.append({"ttfr": (t_ready - t_first) if (t_ready is not None and t_first is not None) else None, "ticks": ticks})
MOD = {"rtmw": "pose", "yolo": "detector", "kpf": "keypoint forecaster", "joint": "joint model", "vjepa": "road student"}
def summarize(ticks, label, gid, ref=None, n_sessions=1):
    e = np.clip(np.array([t[1] for t in ticks]), 0, 399.99); counts, _ = np.histogram(e, bins=200, range=(0, 400))
    mods = {}
    for t in ticks:
        for k, v in t[2].items(): mods.setdefault(k, []).append(v)
    fb = [t[3] for t in ticks]; reasons = {}
    for t in ticks:
        if t[3] != "cockpitwm" and t[4]: reasons[t[4]] = reasons.get(t[4], 0) + 1
    g = {"id": gid, "label": label, "counts": counts.tolist(), "p50": num(np.percentile(e, 50), 1), "p95": num(np.percentile(e, 95), 1), "p99": num(np.percentile(e, 99), 1), "n": len(ticks),
         "ready_pct": num(100 * np.mean([t[5] for t in ticks]), 1), "fallback_pct": num(100 * np.mean([f != "cockpitwm" for f in fb]), 1), "top_fallback_reasons": sorted(reasons.items(), key=lambda kv: -kv[1])[:3],
         "modules": {MOD.get(k, k): {"p50": num(np.percentile(v, 50), 1), "p95": num(np.percentile(v, 95), 1)} for k, v in mods.items()}, "sessions": n_sessions}
    if ref: g["ref"] = {"p50": ref[0], "p95": ref[1], "label": "paper"}
    return g
groups, used = [], set()
for gid, ttfr, win, p50, p95 in PAPER:
    cand = [i for i, s in enumerate(sessions) if s["ttfr"] is not None and abs(s["ttfr"] - ttfr) <= 0.2]
    assert len(cand) == 1, (gid, cand); used.add(cand[0]); tk = [t for t in sessions[cand[0]]["ticks"] if t[0] <= win]
    g = summarize(tk, gid.replace("-", " ").title(), gid, ref=(p50, p95)); g["window_s"] = win; g["time_to_first_ready_s"] = num(ttfr, 1); groups.append(g)
    dev = abs(g["p95"] - p95) / p95
    print(f"  latency {gid}: log p50/p95 {g['p50']}/{g['p95']} vs paper {p50}/{p95} ({dev*100:.1f} % p95 dev)"); assert dev <= 0.05, f"{gid} p95 deviates {dev:.2%} from the paper"
others = [t for i, s in enumerate(sessions) if i not in used for t in s["ticks"]]
groups.append(summarize(others, f"All other sessions ({len(sessions) - len(used)})", "others", n_sessions=len(sessions) - len(used)))
put("latency", "latency.json", {"schema": "hist/1", "bin_w": 2, "x0": 0, "unit": "ms", "groups": groups, "lines": [{"v": 300, "label": "300 ms p95 target", "color": "coral"}],
    "meta": {"source": "device logs (pred_log.jsonl, 5 Hz probe ticks) · tick rule: every tick with an end-to-end latency sample, as in the paper's analysis script",
             "headline": "the three paper drives are matched by time-to-first-ready and aggregated over the paper's windows; 'log ▸ paper' pairs are recomputed vs reported", "hardware": "comma four + external RX 9060 8 GB GPU", "sessions_total": len(sessions)}})

# ====================================================================== 3. user study (paired slope) + warning probe (paired dumbbell)
tex = open(glob.glob(os.path.join(D, "ICLR", "**", "appendix_userstudy.tex"), recursive=True)[0], encoding="utf8").read()
tab = tex[tex.find(r"\label{tab:participants}"):]; tab = tab[:tab.find(r"\end{tabular}")]; rows = []
for line in tab.splitlines():
    m = re.match(r"\s*(P\d\d)\s*&(.*)\\\\", line)
    if not m: continue
    c = [x.strip() for x in m.group(2).split("&")]; f = lambda x: None if x in ("--", "-", "") else float(x)
    rows.append({"id": m.group(1), "app_c": f(c[0]), "app_s": f(c[1]), "tim_c": f(c[2]), "tim_s": f(c[3]), "ann_c": f(c[4]), "ann_s": f(c[5]), "pref": c[6]})
assert len(rows) == 14
def grp(gid, label, a, b, delta, ci, p, cost=False):
    rr = [{"id": r["id"], "a": r[a], "b": r[b]} for r in rows]; return {"id": gid, "label": label, "n": sum(1 for r in rr if r["a"] is not None and r["b"] is not None), "delta": delta, "ci": ci, "p": p, "cost": cost, "rows": rr}
pref = {k: sum(1 for r in rows if r["pref"] == k) for k in ("C", "S", "Equal")}
put("userstudy", "userstudy.json", {"schema": "paired/1", "mode": "slope", "axis": {"min": 1, "max": 7, "label": "construct score (1–7)"}, "from": "openpilot DMS", "to": "TriDrive",
    "groups": [grp("appropriateness", "Appropriateness", "app_s", "app_c", 1.79, [0.86, 2.75], 0.008), grp("timeliness", "Timeliness", "tim_s", "tim_c", 2.67, [1.33, 4.08], 0.008), grp("annoyance", "Annoyance (cost)", "ann_s", "ann_c", 1.17, [0.33, 2.08], 0.031, cost=True)],
    "meta": {"preference": {"TriDrive": pref["C"], "openpilot": pref["S"], "equal": pref["Equal"]}, "source": "arXiv 2609.33000 v1 · appendix table of participant-level construct scores; Δ / 95 % CI / p from the paper text"}})
put("probe", "probe.json", {"schema": "paired/1", "mode": "dumbbell", "axis": {"min": 0.5, "max": 0.8, "label": "AUROC", "chance": 0.5}, "from": "openpilot-based baseline", "to": "TriDrive probe",
    "groups": [{"id": "auroc", "label": "Warning probe AUROC", "rows": [{"id": "manual", "label": "Manual driving (human-labeled)", "a": 0.563, "b": 0.725, "emph": True}, {"id": "pooled", "label": "Pooled", "a": 0.637, "b": 0.716, "emph": True}, {"id": "engaged", "label": "Assistance engaged", "a": 0.746, "b": 0.664, "emph": True}],
                "note": "calibration error 0.028 (probe) vs 0.408 (baseline); on engaged driving the baseline is better — shown, not hidden"}], "meta": {"source": "arXiv 2609.33000 v1"}})

# ====================================================================== 4. figures
FIG = [("arch", os.path.join(D, "AAAI/ICLR/supplimentary/video/build/arch.png"), 2000, 350_000, None, None),
       ("teaser", os.path.join(D, "AAAI/ICLR/supplimentary/video/build/teaser.png"), 2400, 450_000, (0, 0, 1, 1880 / 2641), [(0.003, 0.105, 0.147, 0.365), (0.228, 0.133, 0.283, 0.344), (0.685, 0.133, 0.997, 0.344)]),
       ("user_study_bars", os.path.join(D, "ICLR/figures/user_study_bars_n14.png"), 1650, 200_000, None, None),
       ("hw_experiment", os.path.join(D, "AAAI/ICLR/supplimentary/video/video_frame/experiment.jpg"), 1600, 300_000, None, None),
       ("hw_deployment1", os.path.join(D, "AAAI/ICLR/supplimentary/video/video_frame/deployment1.jpg"), 1600, 300_000, None, None),
       ("hw_deployment2", os.path.join(D, "AAAI/ICLR/supplimentary/video/video_frame/deployment2.jpg"), 1600, 300_000, None, None)]
cc_pdf = os.path.join(D, "ICLR/figures/causal_cases.pdf"); cc_png = os.path.join(WORK, "causal_cases.png")
if os.path.exists(cc_pdf) and not os.path.exists(cc_png): subprocess.run(["pdftoppm", "-r", "170", "-png", "-singlefile", cc_pdf, cc_png[:-4]], check=True)
if os.path.exists(cc_png): FIG.append(("causal_cases", cc_png, 2200, 400_000, None, [(0.0, 0.0, 0.207, 0.43), (0.5, 0.0, 0.707, 0.43)]))  # night cabin stills from the deployment device → blurred
for key, src, w, cap, box, blur in FIG:
    dst = os.path.join(MEDIA, f"fig_{key}.jpg"); h = entry_hash({"w": w, "cap": cap, "box": box, "blur": blur}, src)
    if not A.skip_media and (A.force or not ledger.done("fig_" + key, h) or not os.path.exists(dst)): q = jpeg_fit(src, dst, max_w=w, cap_bytes=cap, box=box, blur_boxes=blur); ledger.mark("fig_" + key, h, q=q)
    if os.path.exists(dst):
        files[f"fig_{key}"] = media_entry(f"fig_{key}.jpg")
        items.append({"id": f"fig_{key}", "kind": "figure", "title": key, "files": {"image": f"static/media/fig_{key}.jpg"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": key == "teaser",
                      "privacy": {"kind": "figure", "source_pixels": key.startswith("hw_") or key == "teaser", "manual_review": "pending", "reviewed_by": None, "reviewed_at": None,
                                  "note": "cabin regions blurred, participant row cropped" if key == "teaser" else ("cabin panels blurred (deployment device)" if key == "causal_cases" else ("face-free hardware photo" if key.startswith("hw_") else "paper figure"))},
                      "provenance": {"source": os.path.basename(src)}, "entry_hash": h})
        print(f"  fig   {key:18s} {os.path.getsize(dst)//1024:5d} KB")

# ====================================================================== 5. sources, numbers, preview, manifest
sources = [
    {"id": "arxiv-abs", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "48.05 versus 71.47 All-MPJPE"},
    {"id": "arxiv-hours", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "197.2 hours of naturalistic BATON"},
    {"id": "arxiv-latency", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "177 ms p95 latency"},
    {"id": "arxiv-study", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "14 drivers rate its warnings as more appropriate (+1.79) and timely (+2.67)"},
    {"id": "arxiv-probe", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "AUROC 0.725 versus 0.563"},
    {"id": "arxiv-prauc", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-09-26", "locator": "Abstract", "quote": "0.084 for steering onset and 0.286 for time-to-collision drops"},
    {"id": "hf-tridrive", "kind": "hf-card", "url": "https://huggingface.co/HenryYHW/TriDrive", "date": TODAY, "locator": "model card", "quote": "released under CC BY-SA 4.0"},
    {"id": "log-latency", "kind": "log", "url": None, "date": TODAY, "locator": f"pred_log.jsonl · {len(sessions)} sessions · 5 Hz probe ticks", "quote": f"drive 1 p50/p95 {groups[0]['p50']}/{groups[0]['p95']} ms (paper 83/153)"},
    {"id": "log-clips", "kind": "log", "url": None, "date": TODAY, "locator": "annotation clips + route CSVs, lab recorder", "quote": f"{len(specs)} clips · onset at 5.0 s · 10 Hz"}]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg = {}
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("tridrive:"): reg["_on"] = True; continue
    if not line.startswith(" ") and line.strip(): reg["_on"] = False
    if reg.get("_on") and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
reg.pop("_on", None); put("numbers", "numbers.json", {"schema": "numbers/1", "page": "tridrive", "numbers": reg})
sig0 = json.load(open(os.path.join(DATA, f"signals_{specs[0]['id']}.json"))); n30 = min(sig0["n"], 30)
preview = {"schema": "signals/1", "id": sig0["id"] + "_preview", "hz": 10, "n": n30, "t0": 0.0, "duration_s": n30 / 10, "cols": {k: v[:n30] for k, v in sig0["cols"].items() if k in ("t", "risk", "v_ego_mps", "is_distracted")}, "labels": sig0["labels"], "ranges": sig0.get("ranges", {}), "events": [], "shade": sig0.get("shade", []), "thresholds": sig0.get("thresholds", []), "meta": {"preview_of": sig0["id"]}}
put("preview", "preview.json", preview, first_view=True)
first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"]["poster"] for it in items if it["kind"] == "clip" and it["first_view"]) + sum(it["bytes"].get("image", 0) for it in items if it["kind"] == "figure" and it["first_view"])
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "tridrive", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": items}
mp = os.path.join(DATA, "manifest.json"); write_json(mp, manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view data+posters {first/1e6:.2f} MB")
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
