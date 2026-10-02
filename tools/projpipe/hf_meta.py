#!/usr/bin/env python3
"""Snapshot the public Hugging Face API (no token) for the lab's repos → assets/proj/data/hf_meta.json (hf_meta/1).
publish.sh stamps the result into each page's #data band as static markup; pages never fetch HF at runtime."""
import json, sys, urllib.request, datetime, os
REPOS = [("datasets", "HenryYHW/ADAS-TO"), ("datasets", "HenryYHW/ADAS-TO-Sample"), ("datasets", "HenryYHW/ADAS-TO-Critical"), ("datasets", "HenryYHW/ADAS-TO_longitudinal"),
         ("datasets", "HenryYHW/BATON"), ("datasets", "HenryYHW/BATON-Sample"), ("datasets", "HenryYHW/DriveDNA"), ("datasets", "HenryYHW/DriveDNA-Sample"),
         ("datasets", "HenryYHW/DriveMotion"), ("datasets", "HenryYHW/VLAlert"), ("models", "HenryYHW/TriDrive")]
LICENSE_NAMES = {"cc-by-nc-4.0": "CC BY-NC 4.0", "cc-by-4.0": "CC BY 4.0", "cc-by-sa-4.0": "CC BY-SA 4.0", "mit": "MIT", "apache-2.0": "Apache 2.0", "other": "custom license"}
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "proj", "data", "hf_meta.json")
def fetch(kind, repo):
    req = urllib.request.Request(f"https://huggingface.co/api/{kind}/{repo}", headers={"User-Agent": "projpipe/1"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
repos, fails = {}, []
for kind, repo in REPOS:
    try: d = fetch(kind, repo)
    except Exception as e: fails.append(f"{repo}: {e}"); continue
    card = d.get("cardData") or {}
    lic = card.get("license"); lic = lic[0] if isinstance(lic, list) else lic
    name = card.get("license_name") or LICENSE_NAMES.get(lic or "", lic)
    repos[repo] = {"type": "model" if kind == "models" else "dataset", "gated": d.get("gated", False), "license": lic, "license_name": name,
                   "lastModified": d.get("lastModified"), "sha": d.get("sha"), "downloads": d.get("downloads"), "private": d.get("private", False)}
out = {"schema": "hf_meta/1", "fetched": datetime.date.today().isoformat(), "repos": repos}
os.makedirs(os.path.dirname(OUT), exist_ok=True); json.dump(out, open(OUT, "w"), indent=1, ensure_ascii=False)
for k, v in repos.items(): print(f"{k:34s} {v['type']:7s} gated={str(v['gated']):6s} {v['license_name']}  {str(v['lastModified'])[:10]}")
if fails: print("FAILED:", *fails, sep="\n  "); sys.exit(1)
