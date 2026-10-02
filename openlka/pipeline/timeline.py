#!/usr/bin/env python3
"""Stage C helper - 1 Hz (or --step) timeline of one route's segments for hand-picking clip windows.

Prints route seconds, eastern time, speed, stock lateral-active (STOCK_SPEC rule), steer request, openpilot
echoes, blinker, lane-change state, lane-model probs, lateral deviation, line codes, steering pressed, brake.

Usage: timeline.py --route HYUNDAI_IONIQ_5/bdda168c0c35fad7/0000003e--b9aaff0805 --segments 7-9 [--step 1.0]
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def nearest(series, t, tol):
    if series is None or len(series) == 0:
        return None
    import numpy as np

    idx = series.index.to_numpy()
    i = int(np.searchsorted(idx, t))
    best = None
    for j in (i - 1, i):
        if 0 <= j < len(idx) and abs(idx[j] - t) <= tol and (best is None or abs(idx[j] - t) < abs(idx[best] - t)):
            best = j
    return None if best is None else series.iloc[best]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--route", required=True)
    ap.add_argument("--segments", required=True, help="e.g. 7-9")
    ap.add_argument("--step", type=float, default=1.0)
    args = ap.parse_args()
    C.nice()
    import pandas as pd

    a, b = (int(x) for x in args.segments.split("-")) if "-" in args.segments else (int(args.segments),) * 2
    car_dir = args.route.split("/")[0]
    mk = C.make_key_for(car_dir)
    spec = C.STOCK_SPEC[mk]
    rdir = os.path.join(C.RAW_DIR, args.route)
    print(f"{'t_route':>8} {'eastern':>8} {'v':>5} {'lka':>3} {'req':>3} {'echo':>4} {'blk':>3} {'lcs':>3} {'pL':>4} {'pR':>4} {'dev':>6} {'cL':>2} {'cR':>2} {'prs':>3} {'brk':>3} {'angle':>6}")
    for seg in range(a, b + 1):
        files = C.seg_files(rdir, seg)
        if not files["rlog"]:
            print(f"seg {seg}: no rlog")
            continue
        msgs = C.read_log(files["rlog"])
        started = C.started_mono(msgs)
        bus_of, _, _ = C.stock_bus_table(msgs, set(spec["addresses"]))
        dec = C.spec_decode(msgs, mk, started, bus_of)
        on = C.eval_rules(spec["lka_on"], dec)
        req = C.eval_rules(spec.get("lka_on_alt"), dec)
        echo = C.echo_mask(msgs, spec["cmd_addrs"], started)
        cl, _ = C.first_col(dec, spec["cols"].get("line_code_l"))
        cr, _ = C.first_col(dec, spec["cols"].get("line_code_r"))
        cs, mv = [], []
        wc = C.gps_clock(msgs, started) or C.wall_clock(msgs, started)  # GPS time preferred (bogus wall clock on some 530075 routes)
        for m in msgs:
            w = m.which()
            if w == "carState":
                c = m.carState
                cs.append((C.rel_t(m, started), c.vEgo, 1 if c.leftBlinker else (2 if c.rightBlinker else 0), int(c.steeringPressed), int(c.brakePressed), c.steeringAngleDeg))
            elif w == "modelV2":
                x = m.modelV2
                if len(x.laneLineProbs) >= 3:
                    pl, pr = x.laneLineProbs[1], x.laneLineProbs[2]
                    dev = (x.laneLines[1].y[0] + x.laneLines[2].y[0]) / 2 if min(pl, pr) >= 0.3 else None
                    mv.append((C.rel_t(m, started), pl, pr, dev, int(x.meta.laneChangeState.raw)))
        cs_df = pd.DataFrame(cs, columns=["t", "v", "blk", "prs", "brk", "angle"]).set_index("t")
        mv_df = pd.DataFrame(mv, columns=["t", "pl", "pr", "dev", "lcs"]).set_index("t")
        echo_s = pd.Series(1, index=sorted(echo)) if echo else None
        t = cs_df.index[0]
        while t <= cs_df.index[-1]:
            r = nearest(cs_df["v"], t, 0.05)
            if r is None:
                t += args.step
                continue
            row = cs_df.iloc[cs_df.index.get_indexer([t], method="nearest")[0]]
            m = mv_df.iloc[mv_df.index.get_indexer([t], method="nearest")[0]] if len(mv_df) else None
            et = C.eastern_str(wc[1] + (t - wc[0]) * 1e9, "%H:%M:%S") if wc else "?"
            lka = nearest(on, t, 0.05)
            rq = nearest(req, t, 0.05)
            ec = nearest(echo_s, t, 0.15) if echo_s is not None else None
            fmt = lambda x, nd=2: "  -" if x is None or (isinstance(x, float) and x != x) else (f"{x:.{nd}f}" if nd else f"{int(x)}")
            print(f"{t:8.1f} {et:>8} {row['v']:5.1f} {fmt(lka, 0):>3} {fmt(rq, 0):>3} {fmt(ec, 0):>4} {int(row['blk']):>3} {fmt(m['lcs'] if m is not None else None, 0):>3} "
                  f"{fmt(m['pl'] if m is not None else None):>4} {fmt(m['pr'] if m is not None else None):>4} {fmt(m['dev'] if m is not None else None):>6} "
                  f"{fmt(nearest(cl, t, 0.06), 0):>2} {fmt(nearest(cr, t, 0.06), 0):>2} {int(row['prs']):>3} {int(row['brk']):>3} {row['angle']:6.1f}")
            t += args.step
        del msgs


if __name__ == "__main__":
    main()
