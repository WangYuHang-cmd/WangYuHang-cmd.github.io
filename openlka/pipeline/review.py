#!/usr/bin/env python3
"""Record the manual privacy review of an exported clip in its meta.json (then re-run build_index.py).

Only set --status ok after a person has looked at poster.jpg and sampled frames of clip.mp4
(no readable plates, no close pedestrians, daylight/scene as described).

Usage: review.py --id ioniq5-i4-stock-lfa --status ok --by "Yuhang Wang" --note "poster + frames at 12/57/74 s checked"
       review.py --id <id> --status rejected --note "..."
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def make_sheet(site, cid, out_path, fracs=(0.15, 0.5, 0.85)):
    """2x2 contact sheet (poster + frames at 15/50/85 % of the clip) for the visual review."""
    import io
    import subprocess

    from PIL import Image, ImageDraw

    d = os.path.join(site, cid)
    meta = json.load(open(os.path.join(d, "meta.json")))
    dur = meta["duration_s"]
    imgs = [Image.open(os.path.join(d, "poster.jpg")).convert("RGB")]
    labels = [f"poster @ {meta['key_moment']['t']} s ({meta['key_moment']['label']})"]
    for f in fracs:
        t = round(dur * f, 1)
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", os.path.join(d, "clip.mp4"), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "-"],
                           capture_output=True)
        imgs.append(Image.open(io.BytesIO(r.stdout)).convert("RGB"))
        labels.append(f"frame @ {t} s")
    w, h = imgs[0].size
    sheet = Image.new("RGB", (2 * w, 2 * h + 18), (20, 20, 20))
    dr = ImageDraw.Draw(sheet)
    for i, (im, lab) in enumerate(zip(imgs, labels)):
        x, y = (i % 2) * w, (i // 2) * h
        sheet.paste(im.resize((w, h)), (x, y))
        dr.text((x + 6, y + 4), lab, fill=(255, 230, 80))
    dr.text((6, 2 * h + 3), f"{cid} · {meta['make']} {meta['model']} · {meta['start_eastern']} · {meta.get('where')}", fill=(200, 200, 200))
    sheet.save(out_path, quality=85)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.path.join(C.SITE_DIR, "can"))
    ap.add_argument("--id", required=True, action="append")
    ap.add_argument("--status", choices=["pending", "ok", "rejected"])
    ap.add_argument("--by", default=os.environ.get("USER", "unknown"))
    ap.add_argument("--note", default="")
    ap.add_argument("--sheet", action="store_true", help="write <work>/clips/<id>/review_sheet.jpg (poster + 3 frames) instead of recording a status")
    args = ap.parse_args()
    if args.sheet:
        for cid in args.id:
            out = os.path.join(C.CLIPS_DIR, cid, "review_sheet.jpg")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            if not os.path.exists(os.path.join(args.site, cid, "meta.json")):
                print(f"{cid}: not exported yet, skipping")
                continue
            print(make_sheet(args.site, cid, out))
        return
    if not args.status:
        ap.error("--status required (or --sheet)")
    for cid in args.id:
        record(args, cid)


def record(args, cid):
    mp = os.path.join(args.site, cid, "meta.json")
    meta = json.load(open(mp))
    meta["privacy"]["manual_review"] = args.status
    meta["privacy"]["reviewed_by"] = args.by
    meta["privacy"]["reviewed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    if args.note:
        meta["privacy"]["review_note"] = args.note
    C.write_json(mp, meta, compact=False)
    print(f"{cid}: privacy.manual_review = {args.status} (re-run build_index.py to refresh index.json and SHA256SUMS)")


if __name__ == "__main__":
    main()
