#!/usr/bin/env python3
"""DriveDNA page exports — LOCAL side. Pulls the server output, adds the embedding (already exported by fixtures_server.py),
the leakage ladder + leaderboard from the paper tables, sources/numbers/preview/manifest. Usage: drivedna_export.py [--pull] [--force]"""
import argparse, glob, json, os, re, shutil, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, CAPS, write_json, carry_review, num, lqip, ffprobe, sha256_file, entry_hash
REPO = PATHS["repo"]; PAGE = os.path.join(REPO, "drivedna"); DATA = os.path.join(PAGE, "static", "data"); MEDIA = os.path.join(PAGE, "static", "media")
WORK = os.path.join(PATHS["work"], "drivedna"); SITE = os.path.join(WORK, "site")
for d in (DATA, MEDIA, WORK): os.makedirs(d, exist_ok=True)
HOST = "henry@100.122.237.116"; PW = os.path.expanduser("~/Desktop/100.122.237.116.txt"); REMOTE = "/data/datasets/temporary/web_showcase_proj/drivedna/"
ARXIV = "https://arxiv.org/abs/2607.23822v1"; TODAY = "2026-10-02"
ap = argparse.ArgumentParser(); ap.add_argument("--pull", action="store_true"); ap.add_argument("--force", action="store_true"); A = ap.parse_args()
if A.pull:
    subprocess.run(["sshpass", "-f", PW, "rsync", "-az", "--delete", f"{HOST}:{REMOTE}site/", SITE + "/"], check=True)
    subprocess.run(["sshpass", "-f", PW, "scp", "-q", f"{HOST}:{REMOTE}embedding_drivedna.json", os.path.join(WORK, "embedding.json")], check=True)
files, items = {}, {}
def put(key, name, obj, first_view=False):
    p = os.path.join(DATA, name); n, h = write_json(p, obj); files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}; print(f"  data  {name:26s} {n/1024:7.1f} KB")
def media_entry(name): p = os.path.join(MEDIA, name); return {"path": "static/media/" + name, "sha256": sha256_file(p), "bytes": os.path.getsize(p)}
for name in sorted(os.listdir(os.path.join(SITE, "data"))):
    obj = json.load(open(os.path.join(SITE, "data", name)))
    if name == "audit_clips.json": obj["schema"] = "media/1"  # posters/videos only, no signals → not a Scrubber clip index
    put(name[:-5], name, obj, first_view=name.startswith("pairs") or name.startswith("signals_pair_final1"))
emb = json.load(open(os.path.join(WORK, "embedding.json"))); put("embedding", "embedding.json", emb, first_view=True)
for f in sorted(os.listdir(os.path.join(SITE, "media"))):
    src, dst = os.path.join(SITE, "media", f), os.path.join(MEDIA, f)
    if A.force or not os.path.exists(dst) or sha256_file(src) != sha256_file(dst): shutil.copyfile(src, dst)
    files[("media_" if f.endswith(".mp4") else "img_") + f.rsplit(".", 1)[0]] = media_entry(f)
pairs = json.load(open(os.path.join(DATA, "pairs.json")))["clips"]
for p_ in pairs:
    items[p_["id"]] = {"id": p_["id"], "kind": "figure", "title": p_["title"], "files": {"frame_a": p_["frames"][0], "frame_b": p_["frames"][1], "signals": p_["src"]}, "bytes": {"image": sum(os.path.getsize(os.path.join(PAGE, f)) for f in p_["frames"])}, "first_view": p_ is pairs[0],
                      "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "forward-camera stills, 526×330, pseudonymous drivers"}, "provenance": {"source": "driver-pair kit (matched-context figure)"}, "entry_hash": entry_hash({"id": p_["id"]})}
aud = json.load(open(os.path.join(DATA, "audit_clips.json")))
for a in aud["items"]:
    mp4 = os.path.join(PAGE, a["video"]); jpg = os.path.join(PAGE, a["poster"]); pr = ffprobe(mp4)
    items[a["id"]] = {"id": a["id"], "kind": "clip", "title": a["label"], "files": {"video": a["video"], "poster": a["poster"]}, "bytes": {"video": pr["bytes"], "poster": os.path.getsize(jpg)}, "first_view": False, "duration_s": num(pr["duration"], 2), "key_moment": {"t": 5.0, "label": a["cls"]}, "poster_lqip": lqip(jpg),
                     "privacy": {"kind": "road", "source_pixels": True, "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "maneuver-audit clip, forward camera only, 526×330, pseudonymous driver"}, "provenance": {"source": "maneuver-audit clip set", "video": {"codec": pr["codec"], "fps": pr["fps"]}}, "entry_hash": entry_hash({"id": a["id"]})}
for f in glob.glob(os.path.join(MEDIA, "fig_*.jpg")):
    key = os.path.basename(f)[:-4]
    items[key] = {"id": key, "kind": "figure", "title": key, "files": {"image": f"static/media/{key}.jpg"}, "bytes": {"image": os.path.getsize(f)}, "first_view": key == "fig_teaser", "privacy": {"kind": "figure", "source_pixels": key in ("fig_teaser", "fig_pair_overlay"), "manual_review": "pending", "reviewed_by": None, "reviewed_at": None, "note": "paper / release figure (road frames only)"}, "provenance": {"source": key + ".png"}, "entry_hash": entry_hash({"id": key}, f)}
# ---- paper tables (arXiv v1 · Section 5): leakage ladder (t3full) + leaderboard (t2) ----
ladder_rows = [("Descriptors (anchor)", .707, .550, True, "ref"), ("Qwen3-4B text (zero-shot)", .596, .551, False, "ref"), ("MOMENT-1 (zero-shot)", .636, .596, False, "ref"),
               ("Video-only probe", .937, .675, True, "multi"), ("CLIP-aligned CAN", .831, .683, False, "multi"), ("JEPA-style SSL", .878, .735, False, "multi"), ("Masked-TS SSL", .907, .740, True, "multi"),
               ("iTransformer + SupCon", .877, .762, False, "sup"), ("PatchTST-CI + SupCon", .932, .777, False, "sup"), ("ArcFace", .902, .807, False, "sup"), ("PatchTST + SupCon", .935, .811, True, "sup")]
put("ladder", "ladder.json", {"schema": "paired/1", "mode": "dumbbell", "axis": {"min": 0.5, "max": 1.0, "label": "AUROC on unseen drivers", "chance": 0.5}, "from": "unmatched", "to": "condition-matched",
    "groups": [{"id": "t3full", "label": "Every representation, Table 3", "rows": [{"id": f"r{i}", "label": l, "a": a, "b": b, "emph": e, "band": g} for i, (l, a, b, e, g) in enumerate(ladder_rows)], "note": "14,868 matched-context pairs on unseen drivers; same vehicle model, scenario and speed regime"}],
    "meta": {"source": "arXiv 2607.23822 v1 · Table 3 (condition-matched evaluation)"}})
lb = [("Descriptors (anchor)", .707, .349, .09, False), ("Qwen3-4B text (zero-shot)", .596, .431, .05, False), ("Llama-3.2-3B text (zero-shot)", .598, .428, .05, False), ("MOMENT-1 (zero-shot)", .636, .408, .08, False),
      ("CLIP-aligned CAN (no labels)", .831, .244, .21, False), ("JEPA-style SSL + probe", .878, .197, .20, False), ("Masked-TS SSL + probe", .907, .166, .29, False),
      ("iTransformer + SupCon", .877, .192, .23, False), ("ArcFace", .902, .174, .39, False), ("PatchTST-CI + SupCon", .932, .127, .32, False), ("PatchTST + SupCon", .935, .127, .44, True)]
put("leaderboard", "leaderboard.json", {"schema": "bars/1", "unit": "", "max": 1.0, "rows": [{"label": l, "v": a, "v2": t1, "emph": e, "note": f"EER {eer:.3f}".replace("0.", ".")} for l, a, eer, t1, e in lb], "meta": {"source": "arXiv 2607.23822 v1 · Table 2 (5-minute enrollment, unseen drivers); v = AUROC, v2 = top-1"}})
sources = [
    {"id": "arxiv-abs", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-07-26", "locator": "Abstract", "quote": "4,121 drives from 465 drivers across 115 vehicle models"},
    {"id": "arxiv-auroc", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-07-26", "locator": "Sec. 5, re-identification", "quote": "Classical descriptors reach AUROC .707"},
    {"id": "arxiv-matched", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-07-26", "locator": "Sec. 5, condition-matched evaluation", "quote": "14,868 matched-context pairs"},
    {"id": "arxiv-leak", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-07-26", "locator": "Sec. 5, leakage probes", "quote": "predicts the route at 347"},
    {"id": "arxiv-drop", "kind": "arxiv", "url": ARXIV, "version": "v1", "date": "2026-07-26", "locator": "Sec. 5", "quote": "the video-only probe falls from .937 to .675"},
    {"id": "hf-card", "kind": "hf-card", "url": "https://huggingface.co/datasets/HenryYHW/DriveDNA", "date": TODAY, "locator": "dataset card", "quote": "Prohibited : re-identification attempts; insurance, employment, or law-enforcement scoring of individuals"},
    {"id": "hf-ids", "kind": "hf-card", "url": "https://huggingface.co/datasets/HenryYHW/DriveDNA", "date": TODAY, "locator": "dataset card", "quote": "VINs, device identifiers, precise timestamps, and GPS coordinates removed"},
    {"id": "hf-windows", "kind": "hf-card", "url": "https://huggingface.co/datasets/HenryYHW/DriveDNA", "date": TODAY, "locator": "dataset card", "quote": "62,674 tagged 60-s windows from 428 drivers (355 in frozen folds)"},
    {"id": "emb", "kind": "log", "url": None, "date": TODAY, "locator": "t-SNE of 128-d window embeddings, 14,930 windows (≤ 60 per driver, 428 drivers); k-NN purity k = 10", "quote": f"purity driver {emb['purity']['driver']} · model {emb['purity']['model']} · scenario {emb['purity']['scenario']}"}]
put("sources", "sources.json", {"schema": "sources/1", "sources": sources})
reg, on = {}, False
for line in open(os.path.join(REPO, "tools/projpipe/registry.yaml"), encoding="utf8"):
    if line.startswith("drivedna:"): on = True; continue
    if not line.startswith(" ") and line.strip(): on = False
    if on and line.strip() and not line.strip().startswith("#"):
        k, _, rest = line.strip().partition(":"); m = re.search(r"value:\s*([-\d.]+)", rest); src = re.search(r"source:\s*(\S+?)[,}]", rest); tag = re.search(r"tag:\s*([^,}]+)", rest)
        if m: reg[k] = {"value": float(m.group(1)), "source": src.group(1) if src else None, "tag": tag.group(1).strip() if tag else None}
put("numbers", "numbers.json", {"schema": "numbers/1", "page": "drivedna", "numbers": reg})
sig0 = json.load(open(os.path.join(DATA, "signals_pair_final1.json"))); put("preview", "preview.json", {**{k: v for k, v in sig0.items() if k != "cols"}, "id": "preview", "n": 40, "duration_s": 4.0, "cols": {k: v[:40] for k, v in sig0["cols"].items()}, "events": []}, first_view=True)
first = sum(f["bytes"] for f in files.values() if f.get("first_view")) + sum(it["bytes"].get("image", 0) for it in items.values() if it.get("first_view"))
total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(MEDIA, "*")))
manifest = {"schema": "manifest/1", "page": "drivedna", "generated": TODAY, "pipeline_version": "1", "budget": {"first_view_bytes": CAPS["first_view_bytes"], "total_media_bytes": CAPS["total_media_bytes"], "used_first_view": first, "used_total": total},
            "files": {k: {kk: vv for kk, vv in v.items() if kk != "first_view"} for k, v in files.items()}, "items": carry_review(list(items.values()), os.path.join(DATA, "manifest.json"))}
write_json(os.path.join(DATA, "manifest.json"), manifest); print(f"manifest: {len(files)} files · {len(items)} items · media {total/1e6:.1f} MB · first-view {first/1e6:.2f} MB")
with open(os.path.join(PAGE, "static", "SHA256SUMS"), "w") as fh:
    for p in sorted(glob.glob(os.path.join(DATA, "*.json")) + glob.glob(os.path.join(MEDIA, "*"))): fh.write(f"{sha256_file(p)}  {os.path.relpath(p, os.path.join(PAGE, 'static'))}\n")
