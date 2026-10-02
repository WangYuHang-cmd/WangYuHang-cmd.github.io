#!/usr/bin/env python3
"""ADAS-TO page exports — LOCAL side. Pulls the server output (adasto_export_server.py), converts the page's GIFs to MP4,
fits the paper figures, and writes sources/numbers/preview/manifest + SHA256SUMS into adasto/static/{data,media}.
Usage: adasto_export.py [--pull] [--force]"""
import argparse, glob, json, os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, h264, fit_cap, poster, lqip, jpeg_fit, ffprobe, sha256_file, entry_hash, Ledger
REPO = PATHS["repo"]; PAGE = os.path.join(REPO, "adasto"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media"); IMG = os.path.join(PAGE, "static", "images")
WORK = os.path.join(PATHS["work"], "adasto"); SITE = os.path.join(WORK, "site"); FIGS = os.path.join(WORK, "figs")
for d in (DATA, MEDIA, WORK, FIGS): os.makedirs(d, exist_ok=True)
HOST = "henry@100.122.237.116"; PW = os.path.expanduser("~/Desktop/100.122.237.116.txt"); REMOTE_SITE = "/data/datasets/temporary/web_showcase_proj/adasto/site/"; REMOTE_FIGS = "/home/henry/Desktop/Drive/ADAS-TO Paper/figs/"
ARXIV = "https://arxiv.org/abs/2603.06986v1"; TODAY = "2026-10-02"
ap = argparse.ArgumentParser(); ap.add_argument("--pull", action="store_true"); ap.add_argument("--force", action="store_true"); A = ap.parse_args()
FIG_NAMES = ["fig_dataset_overview.png", "fig_clip_structure.png", "fig_geo_distribution.png", "ttc_thw_scatter.png", "early_warning_advantage.png", "semantic_clustering.png", "action_sequence.png", "kinematic_signatures.png", "early_warning_demo.png", "speed_cdf.png"]
if A.pull:
    subprocess.run(["sshpass", "-f", PW, "rsync", "-az", "--delete", f"{HOST}:{REMOTE_SITE}", SITE + "/"], check=True)
    subprocess.run(["sshpass", "-f", PW, "scp", "-q"] + [f"{HOST}:{REMOTE_FIGS}{n}" for n in FIG_NAMES] + [FIGS + "/"], check=True)
files, items = {}, {}
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:26s} {n/1024:7.1f} KB")
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}
ledger = Ledger(os.path.join(WORK, "ledger.jsonl")).load()
# ---- server data: copy through write_json (re-scan) ----
for name in sorted(os.listdir(os.path.join(SITE, "data"))):
    obj = json.load(open(os.path.join(SITE, "data", name))); key = name.replace(".json", "")
    for sh in obj.get("shade", []) if isinstance(obj, dict) else []: sh["color"] = "blue"  # engaged shading in blue so the coral bands stay readable
    if key == "longtail":  # dashed threshold guides in normalised bbox coordinates (axes are log10 with the export's offsets)
        import math; bb = obj["bbox"]; gx = (math.log10(3.0 + 0.1) - bb[0]) / (bb[2] - bb[0]); gy = (math.log10(0.8 + 0.05) - bb[1]) / (bb[3] - bb[1])
        obj.setdefault("meta", {})["guides"] = [{"axis": "x", "v": num(gx, 4), "label": "TTC 3 s"}, {"axis": "y", "v": num(gy, 4), "label": "THW 0.8 s"}]
    put(key, name, obj, first_view=key in ("hero", "clips") or key.startswith("signals_clip"))
clips = json.load(open(os.path.join(DATA, "clips.json")))["clips"]
for c in clips:
    for ext in ("mp4", "jpg"):
        src = os.path.join(SITE, "media", f"{c['id']}.{ext}"); dst = os.path.join(MEDIA, f"{c['id']}.{ext}")
        if os.path.exists(src) and (A.force or not os.path.exists(dst) or sha256_file(src) != sha256_file(dst)): subprocess.run(["cp", "-f", src, dst], check=True)
    pr = ffprobe(os.path.join(MEDIA, c["id"] + ".mp4")); jpg = os.path.join(MEDIA, c["id"] + ".jpg")
    if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=526, cap_bytes=CAPS["poster_bytes"], q0=72)
    files[f"media_{c['id']}"] = media_entry(c["id"] + ".mp4"); files[f"poster_{c['id']}"] = media_entry(c["id"] + ".jpg")
    items[c["id"]] = {"id": c["id"], "kind": "clip", "title": c["title"], "files": {"video": c["video"], "poster": c["poster"], "signals": c["src"]}, "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": c is clips[0], "duration_s": num(pr["duration"], 2),
                     "key_moment": {"t": 0.0, "label": "takeover"}, "poster_lqip": lqip(jpg), "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "front camera only, 526×330, release-v2 sample driver (pseudonymous)"},
                     "provenance": {"source": "release v2 clip takeover.mp4", "video": {"codec": pr["codec"], "fps": pr["fps"]}}, "entry_hash": entry_hash({"id": c["id"]})}
# ---- GIFs on the current page → MP4 (road-only takeover montages) ----
gif_keys = sorted({os.path.basename(x)[:-4] for x in glob.glob(os.path.join(IMG, "to_*.gif")) + glob.glob(os.path.join(MEDIA, "to_*.mp4"))})  # source GIFs were removed from the repo once converted
for key in gif_keys:
    g = os.path.join(IMG, key + ".gif"); dst = os.path.join(MEDIA, key + ".mp4"); jpg = os.path.join(MEDIA, key + ".jpg"); h = entry_hash({"g": key}, g)
    if (A.force or not ledger.done(key, h) or not os.path.exists(dst)) and os.path.exists(g):
        fit_cap(lambda crf, scale: h264(g, dst, crf=crf + 1, fps=15, scale=scale), dst, 600_000); poster(dst, jpg, 0.5, q=5)
        if os.path.getsize(jpg) > CAPS["poster_bytes"]: jpeg_fit(jpg, jpg, max_w=800, cap_bytes=CAPS["poster_bytes"], q0=70)
        ledger.mark(key, h)
    pr = ffprobe(dst); files[f"media_{key}"] = media_entry(key + ".mp4"); files[f"poster_{key}"] = media_entry(key + ".jpg")
    items[key] = {"id": key, "kind": "gif2mp4", "title": key.replace("to_", "").replace("_", " "), "files": {"video": f"static/media/{key}.mp4", "poster": f"static/media/{key}.jpg"}, "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": False, "duration_s": num(pr["duration"], 2),
                  "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "road-only montage already published on the page"}, "provenance": {"source": key + ".gif (page asset, 2026)"}, "replaces": [f"static/images/{key}.gif"], "entry_hash": h}
# ---- figures ----
for n in FIG_NAMES:
    src = os.path.join(FIGS, n)
    if not os.path.exists(src): continue
    key = "fig_" + re.sub(r"^fig_", "", n[:-4]); dst = os.path.join(MEDIA, key + ".jpg"); h = entry_hash({"n": n}, src)
    if A.force or not ledger.done(key, h) or not os.path.exists(dst): q = jpeg_fit(src, dst, max_w=2000, cap_bytes=CAPS["figure_bytes"]); ledger.mark(key, h, q=q)
    files[key] = media_entry(key + ".jpg")
    items[key] = {"id": key, "kind": "figure", "title": key, "files": {"image": f"static/media/{key}.jpg"}, "bytes": {"image": os.path.getsize(dst)}, "first_view": key == "fig_dataset_overview", "privacy": {"kind": "figure", "source_pixels": n.startswith("early_warning_demo"), "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "paper figure (ITSC 2026)"}, "provenance": {"source": n}, "entry_hash": h}
# ---- sources / numbers / preview ----
comp = json.load(open(os.path.join(DATA, "composition.json"))); lt = json.load(open(os.path.join(DATA, "longtail.json")))
sources = [
    {"id": "arxiv-abs", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-03-07", "locator": "Abstract", "quote": "15,659 takeover-centered 20 s clips from 327 drivers across 22 vehicle brands"},
    {"id": "arxiv-critical", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-03-07", "locator": "Abstract", "quote": "a long tail of 285 safety-critical cases"},
    {"id": "arxiv-cues", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-03-07", "locator": "Abstract", "quote": "59.3% of critical clips contain actionable visual cues at least 3 seconds before the takeover"},
    {"id": "hf-adasto", "kind": "hf-card", "url": "https://huggingface.co/datasets/HenryYHW/ADAS-TO", "date": TODAY, "locator": "dataset card", "quote": "16,446"},
    {"id": "hf-license", "kind": "hf-api", "url": "https://huggingface.co/datasets/HenryYHW/ADAS-TO", "date": TODAY, "locator": "API: cardData.license", "quote": "cc-by-nc-4.0"},
    {"id": "rel-tables", "kind": "log", "url": None, "date": TODAY, "locator": "release-v2 annotation and feature tables", "quote": f"{comp['clips']:,} clips · {comp['drivers']} drivers · {comp['models']} models · {comp['routes']:,} routes"},
    {"id": "rel-traj", "kind": "log", "url": None, "date": TODAY, "locator": "cover-takeover trajectories (6,218 clips, −10…+10 s)", "quote": "quantile bands per trigger; long tail of min TTC vs min THW"}]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg = {}
on = False
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("adasto:"): on = True; continue
    if not line.startswith(" ") and line.strip(): on = False
    if on and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
put("numbers", "numbers.json", {"schema": "numbers/1", "page": "adasto", "numbers": reg})
hero = json.load(open(os.path.join(DATA, "hero.json"))); prev = dict(hero); prev["series"] = [s for s in hero["series"] if s["id"].endswith("median")]; prev["id"] = "hero_preview"; put("preview", "preview.json", prev, first_view=True)
first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"].get("poster", 0) for it in items.values() if it.get("first_view")) + sum(it["bytes"].get("image", 0) for it in items.values() if it.get("first_view"))
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "adasto", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": carry_review(list(items.values()), os.path.join(DATA, "manifest.json"))}
write_json(os.path.join(DATA, "manifest.json"), manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view data+posters {first/1e6:.2f} MB")
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
