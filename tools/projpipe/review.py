#!/usr/bin/env python3
"""Manual privacy review ledger for a page's manifest items.
  review.py <page> --list                      show items and their review status
  review.py <page> --ok ID [ID…] --by NAME     mark items ok (use "all" for every pending item)
  review.py <page> --reject ID --note TEXT     mark an item rejected (validate.py then fails until it is removed)
The manifest is rewritten through common.write_json (privacy gate)."""
import argparse, datetime, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import PATHS, write_json
ap = argparse.ArgumentParser(); ap.add_argument("page"); ap.add_argument("--list", action="store_true"); ap.add_argument("--ok", nargs="*"); ap.add_argument("--reject"); ap.add_argument("--by", default="unreviewed"); ap.add_argument("--note", default="")
a = ap.parse_args(); mp = os.path.join(PATHS["repo"], a.page, "static", "data", "manifest.json"); m = json.load(open(mp)); today = datetime.date.today().isoformat()
if a.ok:
    for it in m["items"]:
        if "all" in a.ok and it["privacy"]["manual_review"] == "pending" or it["id"] in a.ok:
            it["privacy"].update({"manual_review": "ok", "reviewed_by": a.by, "reviewed_at": today}); print("ok      ", it["id"])
if a.reject:
    for it in m["items"]:
        if it["id"] == a.reject: it["privacy"].update({"manual_review": "rejected", "reviewed_by": a.by, "reviewed_at": today, "note": (it["privacy"].get("note") or "") + " · REJECTED: " + a.note}); print("rejected", it["id"])
if a.ok or a.reject: write_json(mp, m)
for it in m["items"]: print(f"{it['privacy']['manual_review']:9s} {it['kind']:7s} {it['id']:22s} {it['privacy'].get('kind','')} {it['privacy'].get('note','')}")
