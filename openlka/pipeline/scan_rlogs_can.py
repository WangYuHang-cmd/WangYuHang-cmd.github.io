#!/usr/bin/env python3
"""Stage B - per-rlog-segment CAN/OP feature scan -> cache/can_feat.jsonl (resume-safe).

One jsonl row per segment: speed stats, stock lateral-active fraction (STOCK_SPEC rule on the
stock bus), openpilot echo fraction (op_tx), ACC/OP state, modelV2 lane probs / deviation,
pedals, blinkers, lane-change seconds, video anchor (qRoadEncodeIdx), first GPS fix, eastern time,
stock bus table and lka transitions. Uses raw cantools decoding (not the lab decoder) because it
is ~5x faster; export_clip.py runs the lab decoder on the chosen windows.

Usage:
  scan_rlogs_can.py --route HYUNDAI_IONIQ_5/bdda168c0c35fad7/0000003e--b9aaff0805 [--segments 30-90] [--workers 4]
  scan_rlogs_can.py --all [--car-dir X ...] [--dongle Y ...] [--workers 4]
  scan_rlogs_can.py --route ... --force     # rescan even if present in the ledger
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

LEDGER = os.path.join(C.CACHE_DIR, "can_feat.jsonl")
SCAN_VERSION = 1


def _init():
    C.nice()
    C.init_logreader()


def _frac(xs):
    return round(sum(1 for x in xs if x) / len(xs), 4) if xs else None


def scan_segment(task):
    rel_path, seg = task
    car_dir, dongle, route = rel_path.split("/")
    rdir = os.path.join(C.RAW_DIR, rel_path)
    files = C.seg_files(rdir, seg)
    row = {"rel_path": rel_path, "car_dir": car_dir, "dongle": dongle, "route": route, "seg": seg,
           "scan_version": SCAN_VERSION, "has_rlog": files["rlog"] is not None, "has_qcam": files["qcamera"] is not None,
           "ok": False}
    if files["rlog"] is None:
        row["error"] = "no rlog"
        return row
    mk = C.make_key_for(car_dir)
    row["make_key"] = mk
    try:
        t_start = time.time()
        msgs = C.read_log(files["rlog"])
        started = C.started_mono(msgs)
        row["started_mono_present"] = started is not None
        if started is None:
            # fall back: first carState time as zero (keeps the scan going; export handles the real fallback)
            started = next(m.logMonoTime for m in msgs if m.which() == "carState")
        # --- carState / controlsState / modelV2 ----------------------------------------
        v, pressed, brake, gas, acc, lb, rb, ts = [], [], [], [], [], [], [], []
        op_en, curv = [], []
        probs_l, probs_r, dev, lw, lcs = [], [], [], [], []
        for m in msgs:
            w = m.which()
            if w == "carState":
                cs = m.carState
                ts.append(C.rel_t(m, started))
                v.append(cs.vEgo)
                pressed.append(cs.steeringPressed)
                brake.append(cs.brakePressed)
                gas.append(cs.gasPressed)
                acc.append(cs.cruiseState.enabled)
                lb.append(cs.leftBlinker)
                rb.append(cs.rightBlinker)
            elif w == "controlsState":
                op_en.append(m.controlsState.enabled)
                curv.append((m.controlsState.curvature, None))
            elif w == "modelV2":
                mv = m.modelV2
                if len(mv.laneLineProbs) >= 3 and len(mv.laneLines) >= 3:
                    pl, pr = mv.laneLineProbs[1], mv.laneLineProbs[2]
                    probs_l.append(pl)
                    probs_r.append(pr)
                    if min(pl, pr) >= 0.3:
                        yl, yr = mv.laneLines[1].y[0], mv.laneLines[2].y[0]
                        dev.append((yl + yr) / 2.0)
                        lw.append(yr - yl)
                lcs.append(int(mv.meta.laneChangeState.raw))
        if not ts:
            row["error"] = "no carState"
            return row
        n = len(ts)
        row.update({
            "t0": round(ts[0], 3), "t1": round(ts[-1], 3), "n_carstate": n,
            "v_mean": round(sum(v) / n, 3), "v_min": round(min(v), 3), "v_max": round(max(v), 3),
            "frac_v_gt_10": _frac([x > 10 for x in v]), "frac_v_gt_20": _frac([x > 20 for x in v]),
            "pressed_frac": _frac(pressed), "brake_frac": _frac(brake), "gas_frac": _frac(gas), "acc_frac": _frac(acc),
            "blinker_s": round(sum(1 for a, b in zip(lb, rb) if a or b) * (ts[-1] - ts[0]) / max(n - 1, 1), 2),
            "op_enabled_frac": _frac(op_en),
        })
        # curvature at speed: pair controlsState with carState by order (both 100 Hz)
        cv = [abs(c[0]) for c, vv in zip(curv, v) if vv > 12]
        row["curv_absmax_v12"] = round(max(cv), 5) if cv else None
        if probs_l:
            row.update({"prob_min_l": round(min(probs_l), 3), "prob_min_r": round(min(probs_r), 3),
                        "frac_prob_lt_0.3": _frac([min(a, b) < 0.3 for a, b in zip(probs_l, probs_r)])})
        if dev:
            row.update({"dev_mean": round(sum(dev) / len(dev), 3), "dev_absmax": round(max(abs(d) for d in dev), 3),
                        "lane_w_mean": round(sum(lw) / len(lw), 3)})
        row["lane_change_s"] = round(sum(1 for s in lcs if s in (2, 3)) / 20.0, 2)
        # --- video anchor, gps, clock -------------------------------------------------
        va = C.video_anchor(msgs, seg, started)
        row["t_video0"] = round(va["t_video0"], 3) if va else None
        row["n_video_frames"] = va["n_frames"] if va else 0
        for m in msgs:
            if m.which() == "gpsLocation":
                g = m.gpsLocation
                if g.hasFix or (g.latitude != 0.0 and g.longitude != 0.0):
                    row["gps_first"] = [round(g.latitude, 5), round(g.longitude, 5)]
                    break
        wc = C.wall_clock(msgs, started)
        if wc:
            t_c, unix_ns = wc
            row["eastern_t0"] = C.eastern_str(unix_ns + (ts[0] - t_c) * 1e9)
        gc_ = C.gps_clock(msgs, started)
        if gc_:
            row["eastern_gps_t0"] = C.eastern_str(gc_[1] + (ts[0] - gc_[0]) * 1e9)
        # --- stock CAN ---------------------------------------------------------------
        if mk and mk in C.STOCK_SPEC:
            spec = C.STOCK_SPEC[mk]
            addrs = set(spec["addresses"])
            bus_of, table, echoes = C.stock_bus_table(msgs, addrs)
            row["bus_of"] = {str(a): s for a, s in bus_of.items()}
            row["echo_counts"] = {str(a): n for a, n in echoes.items()}
            dec = C.spec_decode(msgs, mk, started, bus_of)
            row["spec_addrs_seen"] = sorted(dec)
            s_on = C.eval_rules(spec["lka_on"], dec)
            s_alt = C.eval_rules(spec.get("lka_on_alt"), dec)
            row["stock_active_frac"] = round(float(s_on.mean()), 4) if s_on is not None else None
            row["steer_req_frac"] = round(float(s_alt.mean()), 4) if s_alt is not None else None
            if s_on is not None and len(s_on) > 1:
                d = s_on.diff().fillna(0)
                row["lka_transitions"] = [[round(float(t), 2), int(x)] for t, x in d[d != 0].items()][:40]
            ech = C.echo_mask(msgs, spec["cmd_addrs"], started)
            row["n_echo"] = len(ech)
            row["op_tx_frac"] = round(len(ech) / max(n, 1), 4)
            tq, src = C.first_col(dec, spec["cols"].get("steer_torque"))
            if tq is not None:
                a = tq.abs()
                row["cmd_torque_p95"] = round(float(a.quantile(0.95)), 2)
                row["cmd_torque_max"] = round(float(a.max()), 2)
                row["cmd_torque_src"] = f"0x{src[0]:X}.{src[1]}"
            for side in ("l", "r"):
                s, _ = C.first_col(dec, spec["cols"].get(f"line_code_{side}"))
                if s is not None:
                    row[f"ll_code_hist_{side}"] = {str(int(k)): int(c) for k, c in s.value_counts().items()}
        row["ok"] = True
        row["scan_s"] = round(time.time() - t_start, 2)
    except Exception as e:  # keep the sweep going
        row["error"] = f"{type(e).__name__}: {e}"[:300]
    return row


def load_ledger():
    done = {}
    if os.path.exists(LEDGER):
        with open(LEDGER) as f:
            for line in f:
                try:
                    r = json.loads(line)
                    done[(r["rel_path"], r["seg"])] = r
                except Exception:
                    pass
    return done


def parse_segments(spec: str | None, available: list[int]) -> list[int]:
    if not spec:
        return available
    out = set()
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            out.update(range(int(a), int(b) + 1))
        else:
            out.add(int(part))
    return [s for s in available if s in out]


def main():
    global LEDGER
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--route", action="append", help="rel_path CAR_DIR/dongle/route (repeatable)")
    ap.add_argument("--all", action="store_true", help="every decodable route under RAW_DIR")
    ap.add_argument("--car-dir", action="append")
    ap.add_argument("--dongle", action="append")
    ap.add_argument("--segments", help="e.g. 30-90 or 3,5,7 (only with a single --route)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--ledger", default=LEDGER)
    args = ap.parse_args()
    LEDGER = args.ledger
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)

    routes = []
    if args.route:
        routes = [r.strip("/") for r in args.route]
    elif args.all:
        # every route of the chosen dongles (default: the three showcase recorders); cars without a decoder
        # still get the openpilot-side features, just no stock CAN block
        dongles = args.dongle or ["530075d26cad58e4", "bdda168c0c35fad7", "d5a6fb2f1b849a62"]
        routes = [rp for car, dongle, route, rp in C.route_list(args.car_dir, dongles)]
    else:
        ap.error("--route or --all required")

    done = load_ledger()
    tasks = []
    for rp in routes:
        rdir = os.path.join(C.RAW_DIR, rp)
        if not os.path.isdir(rdir):
            print(f"!! missing route dir {rdir}", file=sys.stderr)
            continue
        segs = parse_segments(args.segments if len(routes) == 1 else None, C.route_segments(rdir))
        for s in segs:
            if args.force or (rp, s) not in done or not done[(rp, s)].get("ok"):
                tasks.append((rp, s))
    workers = min(args.workers, 8)
    print(f"routes {len(routes)} | tasks {len(tasks)} | already done {len(done)} | workers {workers}")
    if not tasks:
        return
    t0 = time.time()
    n_ok = n_fail = 0
    with Pool(workers, initializer=_init, maxtasksperchild=20) as pool, open(LEDGER, "a") as led:
        for i, row in enumerate(pool.imap_unordered(scan_segment, tasks, chunksize=1), 1):
            led.write(json.dumps(row) + "\n")
            led.flush()
            n_ok += row["ok"]
            n_fail += (not row["ok"])
            if i % 50 == 0 or i == len(tasks):
                el = time.time() - t0
                print(f"  {i}/{len(tasks)} ok {n_ok} fail {n_fail} | {el:.0f}s ({el / i:.2f} s/seg)", flush=True)
    print("done")


if __name__ == "__main__":
    main()
