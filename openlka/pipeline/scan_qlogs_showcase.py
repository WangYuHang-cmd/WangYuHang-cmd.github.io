#!/usr/bin/env python3
"""Stage A - qlog sweep (cheap, ~0.07 s/segment): per-segment speed/engagement features, video anchors,
eastern time and 1 Hz GPS for every route of the showcase dongles.

Outputs (resume-safe, one task per route):
  cache/qlog_feat.jsonl   one row per segment {rel_path, seg, t0, t1, v_mean, v_min, v_max, frac_v_gt_10, frac_v_gt_20,
                          op_enabled_frac, cruise_frac, pressed_frac, blinker_s, t_video0, n_video_frames, eastern_t0 (wall clock),
                          eastern_gps_t0 (GPS time, preferred), clock_skew_s, gps_n, gps_first, gps_last, has_rlog, has_qcam}
                          + one {"route_done": true} marker per route
  cache/gps_1hz.csv       rel_path, seg, t (route s), lat, lon, alt_m, speed_mps, bearing_deg, unix_ms

Usage: scan_qlogs_showcase.py [--dongle D ...] [--car-dir X ...] [--workers 8] [--force]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

LEDGER = os.path.join(C.CACHE_DIR, "qlog_feat.jsonl")
GPS_CSV = os.path.join(C.CACHE_DIR, "gps_1hz.csv")
SHOWCASE_DONGLES = ["530075d26cad58e4", "bdda168c0c35fad7", "d5a6fb2f1b849a62"]


def _init():
    C.nice()
    C.init_logreader()


def _frac(xs):
    return round(sum(1 for x in xs if x) / len(xs), 4) if xs else None


def scan_route(rel_path):
    car_dir, dongle, route = rel_path.split("/")
    rdir = os.path.join(C.RAW_DIR, rel_path)
    rows, gps_rows = [], []
    for seg in C.route_segments(rdir):
        files = C.seg_files(rdir, seg)
        row = {"rel_path": rel_path, "car_dir": car_dir, "dongle": dongle, "route": route, "seg": seg,
               "has_qlog": files["qlog"] is not None, "has_rlog": files["rlog"] is not None, "has_qcam": files["qcamera"] is not None, "ok": False}
        if files["qlog"] is None:
            row["error"] = "no qlog"
            rows.append(row)
            continue
        try:
            msgs = C.read_log(files["qlog"])
            started = C.started_mono(msgs)
            row["started_mono_present"] = started is not None
            if started is None:
                cs0 = next((m for m in msgs if m.which() == "carState"), None)
                if cs0 is None:
                    row["error"] = "no carState"
                    rows.append(row)
                    continue
                started = cs0.logMonoTime
            v, pressed, cruise, lb, rb, ts, op_en = [], [], [], [], [], [], []
            for m in msgs:
                w = m.which()
                if w == "carState":
                    c = m.carState
                    ts.append(C.rel_t(m, started))
                    v.append(c.vEgo)
                    pressed.append(c.steeringPressed)
                    cruise.append(c.cruiseState.enabled)
                    lb.append(c.leftBlinker)
                    rb.append(c.rightBlinker)
                elif w == "controlsState":
                    op_en.append(m.controlsState.enabled)
                elif w == "gpsLocation":
                    g = m.gpsLocation
                    if g.hasFix or (g.latitude != 0.0 and g.longitude != 0.0):
                        gps_rows.append([rel_path, seg, round(C.rel_t(m, started), 2), round(g.latitude, 6), round(g.longitude, 6),
                                         round(g.altitude, 1), round(g.speed, 2), round(g.bearingDeg, 1), int(g.unixTimestampMillis)])
            if not ts:
                row["error"] = "no carState"
                rows.append(row)
                continue
            n = len(ts)
            dur = ts[-1] - ts[0]
            row.update({"t0": round(ts[0], 3), "t1": round(ts[-1], 3), "n_carstate": n,
                        "v_mean": round(sum(v) / n, 3), "v_min": round(min(v), 3), "v_max": round(max(v), 3),
                        "frac_v_gt_10": _frac([x > 10 for x in v]), "frac_v_gt_20": _frac([x > 20 for x in v]),
                        "op_enabled_frac": _frac(op_en), "cruise_frac": _frac(cruise), "pressed_frac": _frac(pressed),
                        "blinker_s": round(sum(1 for a, b in zip(lb, rb) if a or b) * dur / max(n - 1, 1), 2)})
            va = C.video_anchor(msgs, seg, started)
            row["t_video0"] = round(va["t_video0"], 3) if va else None
            row["n_video_frames"] = va["n_frames"] if va else 0
            wc = C.wall_clock(msgs, started)
            if wc:
                row["eastern_t0"] = C.eastern_str(wc[1] + (ts[0] - wc[0]) * 1e9)
            gc_ = C.gps_clock(msgs, started)
            if gc_:
                row["eastern_gps_t0"] = C.eastern_str(gc_[1] + (ts[0] - gc_[0]) * 1e9)
                row["clock_skew_s"] = round(((gc_[1] - gc_[0] * 1e9) - (wc[1] - wc[0] * 1e9)) / 1e9, 1) if wc else None
            seg_gps = [g for g in gps_rows if g[1] == seg]
            row["gps_n"] = len(seg_gps)
            if seg_gps:
                row["gps_first"] = seg_gps[0][3:5]
                row["gps_last"] = seg_gps[-1][3:5]
            row["ok"] = True
        except Exception as e:
            row["error"] = f"{type(e).__name__}: {e}"[:300]
        rows.append(row)
    return rel_path, rows, gps_rows


def load_done():
    done = set()
    if os.path.exists(LEDGER):
        with open(LEDGER) as f:
            for line in f:
                try:
                    r = json.loads(line)
                    if r.get("route_done"):
                        done.add(r["rel_path"])
                except Exception:
                    pass
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dongle", action="append")
    ap.add_argument("--car-dir", action="append")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    os.makedirs(C.CACHE_DIR, exist_ok=True)
    dongles = args.dongle or SHOWCASE_DONGLES
    routes = [rp for car, d, r, rp in C.route_list(args.car_dir, dongles)]
    done = set() if args.force else load_done()
    todo = [rp for rp in routes if rp not in done]
    print(f"routes {len(routes)} | done {len(done)} | todo {len(todo)} | workers {min(args.workers, 8)}")
    if not todo:
        return
    new_csv = not os.path.exists(GPS_CSV) or args.force
    t0 = time.time()
    n_seg = 0
    with Pool(min(args.workers, 8), initializer=_init, maxtasksperchild=25) as pool, open(LEDGER, "a" if not args.force else "w") as led, \
            open(GPS_CSV, "w" if new_csv else "a", newline="") as gf:
        gw = csv.writer(gf)
        if new_csv:
            gw.writerow(["rel_path", "seg", "t", "lat", "lon", "alt_m", "speed_mps", "bearing_deg", "unix_ms"])
        for i, (rp, rows, gps_rows) in enumerate(pool.imap_unordered(scan_route, todo, chunksize=1), 1):
            for r in rows:
                led.write(json.dumps(r) + "\n")
            led.write(json.dumps({"rel_path": rp, "route_done": True, "n_seg": len(rows), "n_ok": sum(r["ok"] for r in rows)}) + "\n")
            led.flush()
            gw.writerows(gps_rows)
            gf.flush()
            n_seg += len(rows)
            if i % 10 == 0 or i == len(todo):
                el = time.time() - t0
                print(f"  {i}/{len(todo)} routes, {n_seg} segs | {el:.0f}s ({el / max(n_seg, 1):.3f} s/seg)", flush=True)
    print("done")


if __name__ == "__main__":
    main()
