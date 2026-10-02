#!/usr/bin/env python3
"""Build static/can/index.json (+ hero-trace.json, SHA256SUMS) from every <site>/can/<clip>/meta.json and validate.

Validator fails on: any cols.* length != n; t not monotonic at 1/hz; duration_s off from ffprobe by > 0.2 s;
event t outside the clip; per-file size caps; missing files; total > 30 MB.

Usage: build_index.py [--site /data/datasets/temporary/web_showcase/site/can] [--default <clip-id>] [--validate-only]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

AGGREGATES = {"dongles": "dongles.json", "signal_availability": "signal_availability.json", "route_map": "routes_map.json", "hero_trace": "hero-trace.json"}


def validate_clip(site, meta, errors):
    cid = meta["id"]
    d = os.path.join(site, cid)
    for k, f in meta["files"].items():
        p = os.path.join(d, f)
        if not os.path.exists(p):
            errors.append(f"{cid}: missing {f}")
            continue
        size = os.path.getsize(p)
        cap = C.CAPS.get(k)
        if cap and size > cap:
            errors.append(f"{cid}: {f} {size} B > cap {cap}")
        if meta.get("sha256", {}).get(k) and C.sha256_file(p) != meta["sha256"][k]:
            errors.append(f"{cid}: sha256 mismatch for {f}")
    sp = os.path.join(d, "signals.json")
    if not os.path.exists(sp):
        return
    sig = json.load(open(sp))
    n, hz = sig["n"], sig["hz"]
    for k, v in sig["cols"].items():
        if len(v) != n:
            errors.append(f"{cid}: cols.{k} length {len(v)} != n {n}")
    for k in C.SIGNAL_COLS:
        if k not in sig["cols"]:
            errors.append(f"{cid}: cols.{k} missing from schema")
    t = sig["cols"]["t"]
    for i in range(1, len(t)):
        if abs((t[i] - t[i - 1]) - 1.0 / hz) > 1e-6 + 1e-3:
            errors.append(f"{cid}: t not monotonic at 1/hz near index {i} ({t[i - 1]} -> {t[i]})")
            break
    if abs(sig["duration_s"] - n / hz) > 1.0 / hz + 1e-6:
        errors.append(f"{cid}: duration_s {sig['duration_s']} inconsistent with n/hz {n / hz}")
    mp4 = os.path.join(d, meta["files"]["video"])
    if os.path.exists(mp4):
        p = C.ffprobe(mp4)
        if abs(p["duration"] - sig["duration_s"]) > 0.2:
            errors.append(f"{cid}: ffprobe duration {p['duration']} vs signals duration {sig['duration_s']}")
    for e in sig["events"]:
        if not (0 <= e["t"] <= sig["duration_s"]):
            errors.append(f"{cid}: event {e} outside the clip")
    if not (4 <= len(sig["events"]) <= 10):
        print(f"warning: {cid} has {len(sig['events'])} events (want 4-10)")
    if meta.get("blurb") and len(meta["blurb"]) > 220:
        errors.append(f"{cid}: blurb is {len(meta['blurb'])} chars (> 220)")
    if not meta.get("system_label") or not meta.get("where"):
        errors.append(f"{cid}: system_label/where missing")
    if not (60.0 - 0.5 <= sig["duration_s"] <= 90.0 + 0.5):
        print(f"warning: {cid} duration {sig['duration_s']} s outside 60-90 s")
    # sign convention: curvature_1pm is documented "+left", like steer_angle_deg -> they must correlate positively
    pairs = [(a, c) for a, c in zip(sig["cols"]["steer_angle_deg"], sig["cols"]["curvature_1pm"]) if a is not None and c is not None]
    if len(pairs) >= 20:
        import statistics
        sa = [p[0] for p in pairs]
        if statistics.pstdev(sa) > 0.5:  # skip when the wheel barely moves
            cv = [p[1] for p in pairs]
            ma, mc = statistics.fmean(sa), statistics.fmean(cv)
            cov = sum((a - ma) * (c - mc) for a, c in pairs)
            den = (sum((a - ma) ** 2 for a in sa) * sum((c - mc) ** 2 for c in cv)) ** 0.5
            corr = cov / den if den > 0 else 0.0
            if corr <= 0:
                errors.append(f"{cid}: corr(steer_angle_deg, curvature_1pm) = {corr:.2f} <= 0 (curvature sign must be +left)")
    # honesty: "stock" clips must have no openpilot transmissions, "openpilot_steering" clips must have them
    title = (meta.get("title") or "").lower()
    scene = meta.get("scene") or []
    op_tx = (meta.get("stats") or {}).get("op_tx_pct") or 0
    if ("stock" in title or "stock_lca" in scene) and op_tx > 0:
        errors.append(f"{cid}: labelled stock but op_tx_pct = {op_tx}")
    if "openpilot_steering" in scene and op_tx == 0:
        errors.append(f"{cid}: scene says openpilot_steering but op_tx_pct = 0")
    # null-not-NaN is guaranteed by json.dump(allow_nan=False); check no NaN sneaked in as strings
    txt = open(sp).read()
    if "NaN" in txt or "Infinity" in txt:
        errors.append(f"{cid}: NaN/Infinity in signals.json")
    tp = os.path.join(d, "track.json")
    if os.path.exists(tp):
        tr = json.load(open(tp))
        if len(tr["pts"]) != len(tr["lka_on"]):
            errors.append(f"{cid}: track pts/lka_on length mismatch")
    fp = os.path.join(d, "frames.json")
    if os.path.exists(fp):
        fr = json.load(open(fp))
        if len(fr["frames"]) > C.CAPS["frames_n"]:
            errors.append(f"{cid}: frames.json has {len(fr['frames'])} frames > {C.CAPS['frames_n']}")
        if "sampling" not in fr:
            errors.append(f"{cid}: frames.json lacks the sampling block")
        if fr["moment"]["t"] != meta["key_moment"]["t"]:
            errors.append(f"{cid}: frames.json moment != meta key_moment")


def hero_trace(site, meta, max_bytes=C.CAPS["hero_trace"], window=None):
    """10 Hz steer/dev/speed excerpt of the default clip: 30-60 s spanning the first lane_change/line_lost
    event to the last takeover/lka event (else centred on the key moment); trimmed to the 8 KB cap."""
    sig = json.load(open(os.path.join(site, meta["id"], "signals.json")))
    hz = sig["hz"]
    cols = sig["cols"]
    n_total = sig["n"]
    dur = n_total / hz
    if window:
        a_t, b_t = window
    else:
        starts = [e["t"] for e in sig["events"] if e["kind"] in ("lane_change", "line_lost")]
        ends = [e["t"] for e in sig["events"] if e["kind"] in ("takeover", "lka_off", "lka_on", "line_back")]
        if starts and ends and max(ends) > min(starts):
            a_t, b_t = min(starts) - 5.0, max(ends) + 3.0
        else:
            k = meta["key_moment"]["t"]
            a_t, b_t = k - 15.0, k + 15.0
    span = min(max(b_t - a_t, 30.0), 60.0, dur)
    a_t = max(0.0, min(a_t, dur - span))
    a = int(round(a_t * hz))
    win = int(round(span * hz))
    b = min(a + win, n_total)
    out = {"version": 1, "hz": hz, "n": b - a, "clip": meta["id"], "t0_clip_s": round(a / hz, 2),
           "events": [e for e in sig["events"] if a / hz <= e["t"] <= b / hz],
           "cols": {k: cols[k][a:b] for k in ("steer_angle_deg", "lane_dev_m", "v_ego_mps")}}
    p = os.path.join(site, "hero-trace.json")
    size = C.write_json(p, out)
    while size > max_bytes and out["n"] > 5 * hz:
        out["n"] = int(out["n"] * 0.8)
        out["cols"] = {k: v[: out["n"]] for k, v in out["cols"].items()}
        size = C.write_json(p, out)
    return size


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.path.join(C.SITE_DIR, "can"))
    ap.add_argument("--default", help="default clip id (else the clip flagged default: true, else the first)")
    ap.add_argument("--validate-only", action="store_true")
    ap.add_argument("--hero-window", nargs=2, type=float, metavar=("A", "B"), help="clip seconds for hero-trace.json (default: auto)")
    ap.add_argument("--allow-pending", action="store_true", help="LOCAL DEV ONLY: include clips whose privacy.manual_review is not 'ok'")
    args = ap.parse_args()
    site = args.site
    all_metas = []
    for mp in sorted(glob.glob(os.path.join(site, "*", "meta.json"))):
        all_metas.append(json.load(open(mp)))
    if not all_metas:
        print("no clips found", file=sys.stderr)
        sys.exit(2)
    # only clips a person has reviewed are published (excluded from index, totals and SHA256SUMS otherwise)
    metas = [m for m in all_metas if m.get("privacy", {}).get("manual_review") == "ok" or args.allow_pending]
    skipped = [m["id"] for m in all_metas if m not in metas]
    for cid in skipped:
        print(f"skipping {cid}: privacy.manual_review != ok")
    errors = []
    for m in metas:
        validate_clip(site, m, errors)
    default = args.default or next((m["id"] for m in all_metas if m.get("default")), all_metas[0]["id"])
    dmeta = next((m for m in all_metas if m["id"] == default), None)
    if dmeta is None:
        errors.append(f"default clip {default} not found")
    elif dmeta.get("privacy", {}).get("manual_review") != "ok":
        errors.append(f"default clip {default} has privacy.manual_review = {dmeta.get('privacy', {}).get('manual_review')!r} (must be ok)")
    if not metas:
        errors.append("no reviewed clips to publish")
    if not args.validate_only and not errors:
        hero_size = hero_trace(site, next(m for m in metas if m["id"] == default), window=args.hero_window)
        print(f"hero-trace.json {hero_size} B from {default}")
    clips = []
    for m in metas:
        files = {k: f"{m['id']}/{f}" for k, f in m["files"].items()}
        files["meta"] = f"{m['id']}/meta.json"
        clips.append({
            "id": m["id"], "title": m["title"], "make": m["make"], "model": m["model"], "make_key": m["make_key"], "dongle": m["dongle"],
            "route": m["route"], "segments": m["segments"], "t_route": m["t_route"], "duration_s": m["duration_s"], "hz": m["hz"],
            "start_eastern": m["start_eastern"], "where": m["where"], "scene": m["scene"], "system_label": m["system_label"],
            "stock_lka_signal": m["stock_lka_signal"], "decoder": m["decoder"]["function"], "dbc": [d["file"] for d in m["dbc"]],
            "files": files, "bytes": {"video": m["bytes"]["video"], "signals": m["bytes"]["signals"]}, "blurb": m.get("blurb"),
            "stats": m["stats"], "key_moment": m["key_moment"], "privacy_review": m["privacy"]["manual_review"],
            "extra_cols": m.get("extra_cols", []), "where_latlon": m.get("where_latlon"),
        })
    included = {m["id"] for m in metas}

    def published(path):
        rel = os.path.relpath(path, site)
        top = rel.split(os.sep)[0]
        return not (os.sep in rel and top not in included)  # clip folders only when reviewed; top-level files always

    total = 0
    for root, _, fs in os.walk(site):
        for f in fs:
            p = os.path.join(root, f)
            if f != "SHA256SUMS" and published(p):
                total += os.path.getsize(p)
    if total > C.CAPS["total"]:
        errors.append(f"total {total} B > cap {C.CAPS['total']}")
    index = {"version": 1, "generated": time.strftime("%Y-%m-%d"), "default": default, "total_bytes": total, "clips": clips}
    for k, f in AGGREGATES.items():
        index[k] = f if os.path.exists(os.path.join(site, f)) else None
    if errors:
        print("VALIDATION FAILED:")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    if args.validate_only:
        print(f"OK: {len(metas)} clip(s), total {total / 1e6:.2f} MB")
        return
    ip = os.path.join(site, "index.json")
    size = C.write_json(ip, index)
    if size > C.CAPS["index"]:
        print(f"warning: index.json {size} B > cap {C.CAPS['index']}")
    # SHA256SUMS over the published files (reviewed clips + top-level files), never itself
    lines = []
    for root, _, fs in os.walk(site):
        for f in sorted(fs):
            p = os.path.join(root, f)
            if f == "SHA256SUMS" or not published(p):
                continue
            lines.append(f"{C.sha256_file(p)}  {os.path.relpath(p, site)}")
    with open(os.path.join(site, "SHA256SUMS"), "w") as f:
        f.write("\n".join(sorted(lines, key=lambda s: s.split('  ', 1)[1])) + "\n")
    print(f"OK: index.json ({size} B) with {len(clips)} clip(s), default {default}, total {total / 1e6:.2f} MB, SHA256SUMS {len(lines)} files"
          + (f"; skipped (not reviewed): {skipped}" if skipped else ""))


if __name__ == "__main__":
    main()
