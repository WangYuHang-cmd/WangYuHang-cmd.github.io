#!/usr/bin/env python3
"""Stage C (helper) - rank candidate 90 s windows from the stage-B ledger and print them for hand-editing clips.yaml.

Segment-level ledger rows cannot prove "v > 20 m/s throughout" for a window that straddles two segments, so
candidates are built from RUNS of consecutive segments that all pass the per-segment gates; the exact
window inside a run is then chosen by hand (or by --around <route_s>) and verified by export_clip.py.

Usage:
  select_clips.py --route HYUNDAI_IONIQ_5/bdda168c0c35fad7/0000003e--b9aaff0805 [--v-min 20] [--stock-min 0.95] [--dur 90]
  select_clips.py --route ... --table            # one line per segment (time, speed, stock %, echoes, probs, transitions)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

LEDGER = os.path.join(C.CACHE_DIR, "can_feat.jsonl")


QLOG_LEDGER = os.path.join(C.CACHE_DIR, "qlog_feat.jsonl")


def load(ledger, route=None, car_dir=None, dongle=None):
    """Stage-B rows (ok only), with GPS-based eastern time joined from the stage-A ledger when available."""
    rows = {}
    with open(ledger) as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if route and r["rel_path"] != route:
                continue
            if car_dir and r.get("car_dir") not in car_dir:
                continue
            if dongle and r.get("dongle") not in dongle:
                continue
            if r.get("ok"):
                rows[(r["rel_path"], r["seg"])] = r
    if os.path.exists(QLOG_LEDGER):
        with open(QLOG_LEDGER) as f:
            for line in f:
                try:
                    q = json.loads(line)
                except Exception:
                    continue
                k = (q.get("rel_path"), q.get("seg"))
                if k in rows and q.get("eastern_gps_t0") and not rows[k].get("eastern_gps_t0"):
                    rows[k]["eastern_gps_t0"] = q["eastern_gps_t0"]
    for r in rows.values():
        # prefer GPS time; the wall clock on several 530075 routes is the device default (2023-11-21 16:10:5x)
        r["eastern_best"] = r.get("eastern_gps_t0") or r.get("eastern_t0")
    return sorted(rows.values(), key=lambda r: (r["rel_path"], r["seg"]))


def hour_of(r):
    et = r.get("eastern_best") or r.get("eastern_t0")
    return int(et[11:13]) if et else None


def is_daylight(r):
    h = hour_of(r)
    return h is not None and 7 <= h <= 19


def fmt_row(r):
    tr = r.get("lka_transitions") or []
    et = r.get("eastern_best") or r.get("eastern_t0") or "?"
    return (f"seg {r['seg']:3d} {et[11:]:>8}{'g' if r.get('eastern_gps_t0') else 'c'} t {r['t0']:7.1f}  v {r['v_min']:5.1f}/{r['v_mean']:5.1f}/{r['v_max']:5.1f}"
            f"  stock {100 * (r.get('stock_active_frac') or 0):5.1f}%  echo {r.get('n_echo', 0):4d}  op {100 * (r.get('op_enabled_frac') or 0):4.0f}%"
            f"  prob<.3 {100 * (r.get('frac_prob_lt_0.3') or 0):4.1f}%  dev|max| {r.get('dev_absmax', 0) or 0:4.2f}  lw {r.get('lane_w_mean') or 0:4.2f}"
            f"  curv {r.get('curv_absmax_v12') or 0:.4f}  lc {r.get('lane_change_s', 0):4.1f}s  blink {r.get('blinker_s', 0):4.1f}s"
            f"  qcam {'y' if r.get('has_qcam') else 'N'}  tr {tr[:6]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ledger", default=LEDGER)
    ap.add_argument("--route", help="rel_path filter")
    ap.add_argument("--car-dir", action="append")
    ap.add_argument("--dongle", action="append")
    ap.add_argument("--table", action="store_true")
    ap.add_argument("--summary", action="store_true", help="one line per route: segments, daylight, stock %, echoes, speed")
    ap.add_argument("--events", action="store_true", help="segments at speed with LKA transitions / line loss / curves (scenario search)")
    ap.add_argument("--daylight", action="store_true", help="only segments starting 07-19 h eastern")
    ap.add_argument("--night", action="store_true", help="only segments starting 20-06 h eastern")
    ap.add_argument("--v-min", type=float, default=20.0)
    ap.add_argument("--stock-min", type=float, default=0.95)
    ap.add_argument("--dur", type=float, default=90.0)
    ap.add_argument("--allow-echo", action="store_true")
    args = ap.parse_args()
    rows = load(args.ledger, args.route, args.car_dir, args.dongle)
    if args.daylight:
        rows = [r for r in rows if is_daylight(r)]
    if args.night:
        rows = [r for r in rows if not is_daylight(r)]
    if not rows:
        print("no rows", file=sys.stderr)
        sys.exit(1)
    if args.table:
        for r in rows:
            print(fmt_row(r))
        return
    if args.summary:
        by_route = {}
        for r in rows:
            by_route.setdefault(r["rel_path"], []).append(r)
        for rp, rs in sorted(by_route.items()):
            moving = [r for r in rs if r.get("v_mean", 0) > 10]
            stock = [r.get("stock_active_frac") or 0 for r in moving]
            echo = sum(r.get("n_echo", 0) for r in rs)
            et = sorted(r["eastern_best"] for r in rs if r.get("eastern_best"))
            print(f"{rp:70s} segs {len(rs):3d} moving {len(moving):3d}  stock@speed {100 * (sum(stock) / len(stock) if stock else 0):5.1f}%  "
                  f"echo {echo:6d}  v_max {max(r.get('v_max', 0) for r in rs):4.1f}  {et[0] if et else '?'} .. {et[-1][11:] if et else '?'}  "
                  f"daylight {sum(1 for r in rs if is_daylight(r))}/{len(rs)}  qcam {sum(1 for r in rs if r.get('has_qcam'))}")
        return
    if args.events:
        for r in rows:
            if r.get("v_mean", 0) < 12 or not r.get("has_qcam"):
                continue
            tr = r.get("lka_transitions") or []
            flags = []
            if 1 <= len(tr) <= 6 and (r.get("stock_active_frac") or 0) > 0.3:
                flags.append("lka_toggle")
            if (r.get("frac_prob_lt_0.3") or 0) > 0.02 and (r.get("frac_prob_lt_0.3") or 0) < 0.3:
                flags.append("line_loss")
            if (r.get("curv_absmax_v12") or 0) > 0.004:
                flags.append("curve")
            if r.get("lane_change_s", 0) > 2:
                flags.append("lane_change")
            if r.get("brake_frac", 0) > 0.02:
                flags.append("brake")
            if flags:
                print(f"{r['rel_path']:68s} " + fmt_row(r) + f"  torque p95/max {r.get('cmd_torque_p95')}/{r.get('cmd_torque_max')}  [{' '.join(flags)}]")
        return
    # runs of consecutive segments passing the gates
    def passes(r):
        return (r.get("has_qcam") and r.get("v_min", 0) > args.v_min and (r.get("stock_active_frac") or 0) >= args.stock_min
                and (args.allow_echo or r.get("n_echo", 0) == 0))

    by_route = {}
    for r in rows:
        by_route.setdefault(r["rel_path"], []).append(r)
    for rp, rs in by_route.items():
        if not any(passes(r) for r in rs):
            continue
        print(f"== {rp}: {len(rs)} segments scanned")
        run = []
        runs = []
        for r in rs:
            if passes(r) and (not run or r["seg"] == run[-1]["seg"] + 1):
                run.append(r)
            else:
                if run:
                    runs.append(run)
                run = [r] if passes(r) else []
        if run:
            runs.append(run)
        for run in runs:
            t0, t1 = run[0]["t0"], run[-1]["t1"]
            if t1 - t0 < args.dur:
                continue
            print(f"-- steady run segs {run[0]['seg']}-{run[-1]['seg']}  route s {t0:.1f}-{t1:.1f} ({t1 - t0:.0f} s)  {run[0].get('eastern_best')}")
            for r in run:
                print("   " + fmt_row(r))
            # neighbours with an event right after the run (brief disengagement / line loss)
            nxt = [r for r in rs if r["seg"] == run[-1]["seg"] + 1]
            if nxt:
                print("   next: " + fmt_row(nxt[0]))


if __name__ == "__main__":
    main()
