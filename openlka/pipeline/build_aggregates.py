#!/usr/bin/env python3
"""Aggregates for the CAN lab: dongles.json, signal_availability.json, routes_map.json -> <site>/can/

  dongles.json              per recorder: hours (route_master, 1 dp) + hours_scanned (stage A), km, route logs (raw dir after
                            the junk filter), segments, makes with human model names, first/last date (stage A eastern time)
  signal_availability.json  per make: rows {col, address, msg, signal, unit, semantics, stock_bus, in_lab_decoder, seen_pct}
                            from STOCK_SPEC + the lab decoder source (regex) + DBC units/VAL tables + stage-B "seen" flags
  routes_map.json           stage-A 1 Hz GPS -> 0.1 Hz -> RDP (0.00015 deg) -> 5-dp [lon, lat], grouped by dongle, <= 600 KB

Usage: build_aggregates.py [--site .../site/can] [--only dongles|signals|map]
"""
from __future__ import annotations

import argparse
import collections
import csv
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

SHOWCASE_DONGLES = ["530075d26cad58e4", "bdda168c0c35fad7", "d5a6fb2f1b849a62"]
DONGLE_NOTES = {"bdda168c0c35fad7": "main lab recorder", "530075d26cad58e4": "second lab recorder", "d5a6fb2f1b849a62": "Kia EV6 recorder"}
QLOG_LEDGER = os.path.join(C.CACHE_DIR, "qlog_feat.jsonl")
CAN_LEDGER = os.path.join(C.CACHE_DIR, "can_feat.jsonl")
GPS_CSV = os.path.join(C.CACHE_DIR, "gps_1hz.csv")


def read_jsonl(path):
    """Ledger rows, deduplicated by (rel_path, seg) keeping the LAST row (the same rule as scan_rlogs_can.load_ledger);
    rows without a seg (route_done markers) are kept as they are."""
    if not os.path.exists(path):
        return []
    by_key, others = {}, []
    with open(path) as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if "rel_path" in r and "seg" in r:
                by_key[(r["rel_path"], r["seg"])] = r
            else:
                others.append(r)
    return list(by_key.values()) + others


# ----------------------------------------------------------------------------- dongles
def build_dongles(site):
    rm = C.route_master_rows(lambda r: r["dongle"] in SHOWCASE_DONGLES)
    raw = [x for x in C.route_list(dongles=SHOWCASE_DONGLES)]
    qrows = [r for r in read_jsonl(QLOG_LEDGER) if r.get("ok") and r.get("dongle") in SHOWCASE_DONGLES]
    out = {"version": 1, "generated": __import__("time").strftime("%Y-%m-%d"), "source": {"hours_km": "route_master.csv (junk route ids filtered)",
           "route_logs_segments": "raw Dataset dir listing", "dates_hours_scanned": "stage A qlog scan"}, "dongles": [], "totals": {}}
    tot = collections.Counter()
    for d in SHOWCASE_DONGLES:
        rows = [r for r in rm if r["dongle"] == d]
        routes_raw = [x for x in raw if x[1] == d]
        n_seg = sum(len(C.route_segments(os.path.join(C.RAW_DIR, rp))) for _, _, _, rp in routes_raw)
        minutes = sum(float(r.get("dur_min") or 0) for r in rows)
        km = sum(float(r.get("km") or 0) for r in rows)
        q = [r for r in qrows if r["dongle"] == d]
        scanned_s = sum((r["t1"] - r["t0"]) for r in q if r.get("t1") is not None)
        # GPS time only: the wall clock is the device default (2023-11-21) on routes recorded before time sync
        dates = sorted(r["eastern_gps_t0"][:10] for r in q if r.get("eastern_gps_t0"))
        makes = []
        for car in sorted({x[0] for x in routes_raw}):
            mk, model = C.CAR_NAMES.get(car, (car, ""))
            car_rows = [r for r in rows if r["car_dir"] == car]
            n_rlog = sum(1 for r in [x for x in q if x["car_dir"] == car] if r.get("has_rlog"))
            makes.append({"car_dir": car, "make": mk, "model": model, "routes": sum(1 for x in routes_raw if x[0] == car),
                          "minutes": round(sum(float(r.get("dur_min") or 0) for r in car_rows), 1), "km": round(sum(float(r.get("km") or 0) for r in car_rows), 1),
                          "segments_with_rlog": n_rlog, "decodable": C.make_key_for(car) is not None})
        months = collections.Counter(r["eastern_gps_t0"][:7] for r in q if r.get("eastern_gps_t0") and r.get("seg") == 0)
        ent = {"dongle": d, "note": DONGLE_NOTES.get(d), "hours": round(minutes / 60, 1), "hours_scanned": round(scanned_s / 3600, 1), "km": round(km, 1),
               "route_logs": len(routes_raw), "route_master_routes": len(rows), "segments": n_seg, "segments_with_rlog": sum(1 for r in q if r.get("has_rlog")),
               "first_date": dates[0] if dates else None, "last_date": dates[-1] if dates else None, "date_source": "gpsLocation.unixTimestampMillis",
               "routes_per_month": dict(sorted(months.items())), "makes": makes}
        out["dongles"].append(ent)
        tot["hours"] += ent["hours"]; tot["km"] += ent["km"]; tot["route_logs"] += ent["route_logs"]; tot["segments"] += n_seg
        tot["hours_scanned"] += ent["hours_scanned"]
    out["totals"] = {k: round(v, 1) for k, v in tot.items()}
    size = C.write_json(os.path.join(site, "dongles.json"), out)
    print(f"dongles.json {size} B: " + "; ".join(f"{e['dongle'][:6]} {e['hours']} h {e['km']} km {e['route_logs']} routes {e['segments']} segs" for e in out["dongles"]))
    return out


# ----------------------------------------------------------------------------- signal availability
def parse_lab_decoder(fn_name):
    """(addr -> {signal: lab_column}) used by one lab decoder function (regex over CAN_decoder_functions.py)."""
    src = open(os.path.join(C.LAB_DIR, "CAN_decoder_functions.py")).read()
    m = re.search(rf"^def {fn_name}\(.*?(?=^def |\Z)", src, re.S | re.M)
    if not m:
        return {}
    body = m.group(0)
    out = collections.defaultdict(dict)
    addr = None
    for line in body.splitlines():
        if line.lstrip().startswith("#"):
            continue
        a = re.search(r"raw_frame\.address == (\d+)", line) or re.search(r"decode_message\(\s*(\d+)", line)
        if a:
            addr = int(a.group(1))
        s = re.search(r'logs?_dicts?\["(\w+)"\]\[key\]\s*=\s*\w+\[\s*"(\w+)"', line)
        if s and addr is not None:
            out[addr][s.group(2)] = s.group(1).replace("_dt", "")
            continue
        s = re.search(r'safe_log_update\(\s*\w+,\s*key,\s*"(\w+)",\s*\w+,\s*"(\w+)"', line)
        if s and addr is not None:
            out[addr][s.group(2)] = s.group(1).replace("_dt", "")
    # multi-line safe_log_update( ... ) calls
    for s in re.finditer(r'safe_log_update\(\s*\w+,\s*key,\s*"(\w+)",\s*\w+,\s*"(\w+)",?\s*\)', body, re.S):
        pos = s.start()
        prev = body[:pos]
        a = None
        for mm in re.finditer(r"raw_frame\.address == (\d+)|decode_message\(\s*(\d+)", prev):
            a = int(mm.group(1) or mm.group(2))
        if a is not None and s.group(2) not in out[a]:
            out[a][s.group(2)] = s.group(1).replace("_dt", "")
    return out


def build_signals(site):
    crows = [r for r in read_jsonl(CAN_LEDGER) if r.get("ok") and r.get("make_key")]
    by_make = collections.defaultdict(list)
    for r in crows:
        by_make[r["make_key"]].append(r)
    out = {"version": 1, "generated": __import__("time").strftime("%Y-%m-%d"), "makes": []}
    for mk, spec in C.STOCK_SPEC.items():
        fn_name, dict_name, dbc_file = C.DECODERS[mk]
        db = C.load_dbc(spec["dbc"])
        lab = parse_lab_decoder(fn_name)
        rows = by_make.get(mk, [])
        seen = collections.Counter()
        bus = collections.defaultdict(collections.Counter)
        for r in rows:
            for a in r.get("spec_addrs_seen", []):
                seen[a] += 1
            for a, s in (r.get("bus_of") or {}).items():
                bus[int(a)][s] += 1
        # unified column map (addr, signal) -> column
        colmap = {}
        for rule in spec["lka_on"]:
            colmap[(rule["addr"], rule["signal"])] = "lka_on"
        for col, cands in spec["cols"].items():
            for a, s in cands:
                colmap.setdefault((a, s), col)
        for col, ex in (spec.get("extra_cols") or {}).items():
            for a, s in ex["src"]:
                colmap.setdefault((a, s), col)
        sig_rows = []
        addrs = set(spec["addresses"]) | set(lab)
        for a in sorted(addrs):
            try:
                mdef = db.get_message_by_frame_id(a)
            except KeyError:
                mdef = None
            names = list(spec["addresses"].get(a, {}).get("signals", []))
            for s in lab.get(a, {}):
                if s not in names:
                    names.append(s)
            for s in names:
                sdef = mdef.get_signal_by_name(s) if mdef and s in {x.name for x in mdef.signals} else None
                sem = None
                if sdef is not None and sdef.choices:
                    sem = ", ".join(f"{int(k)} {v}" for k, v in sorted(sdef.choices.items(), key=lambda kv: int(kv[0])))[:200]
                sig_rows.append({
                    "col": colmap.get((a, s)), "address": f"0x{a:03X}", "msg": mdef.name if mdef else spec["addresses"].get(a, {}).get("msg"),
                    "signal": s, "unit": (sdef.unit if sdef is not None and sdef.unit else None),
                    "semantics": sem or (spec["units"].get(colmap.get((a, s)), None) if colmap.get((a, s)) else None),
                    "stock_bus": (bus[a].most_common(1)[0][0] if bus.get(a) else None), "in_lab_decoder": s in lab.get(a, {}),
                    "lab_column": lab.get(a, {}).get(s), "seen_pct": round(100.0 * seen[a] / len(rows), 1) if rows else None,
                })
        ent = {"make_key": mk, "label": spec["label"], "system_name": spec.get("system_name"), "decoder": fn_name, "ext_dict": dict_name, "dbc": spec["dbc"],
               "dbc_sha256": C.dbc_info(spec["dbc"])["sha256"], "stock_lka_signal": spec["stock_lka_signal"], "verified": spec.get("verified", False),
               "line_code": spec.get("line_code"), "line_code_note": spec.get("line_code_note"), "segments_scanned": len(rows),
               "stock_active_segments": sum(1 for r in rows if (r.get("stock_active_frac") or 0) > 0.5),
               "echo_segments": sum(1 for r in rows if r.get("n_echo", 0) > 0), "signals": sig_rows}
        cdf = C.lab_modules()[0]
        ent["lab_columns"] = len([k for k in getattr(cdf, dict_name) if k])
        out["makes"].append(ent)
    size = C.write_json(os.path.join(site, "signal_availability.json"), out)
    print(f"signal_availability.json {size} B: " + "; ".join(f"{e['make_key']} {len(e['signals'])} sig / {e['segments_scanned']} segs" for e in out["makes"]))
    return out


# ----------------------------------------------------------------------------- routes map
def build_map(site, max_bytes=600_000):
    from shapely.geometry import LineString

    pts = collections.defaultdict(list)
    with open(GPS_CSV, newline="") as f:
        for r in csv.DictReader(f):
            pts[r["rel_path"]].append((float(r["t"]), float(r["lat"]), float(r["lon"])))
    qdates = {}
    for r in read_jsonl(QLOG_LEDGER):
        if r.get("ok") and r.get("eastern_gps_t0") and r["rel_path"] not in qdates:
            qdates[r["rel_path"]] = r["eastern_gps_t0"][:10]
    tol = 0.00015
    while True:
        groups = collections.defaultdict(list)
        n_pts = 0
        bbox = [180, 90, -180, -90]
        for rp, p in pts.items():
            p.sort()
            car_dir, dongle, route = rp.split("/")
            if dongle not in SHOWCASE_DONGLES:
                continue
            # 1 Hz -> 0.1 Hz
            ds, last = [], None
            for t, lat, lon in p:
                b = int(t // 10)
                if b != last:
                    ds.append((lon, lat))
                    last = b
            if len(ds) < 2:
                continue
            line = LineString(ds).simplify(tol, preserve_topology=False)
            coords = [[round(x, 5), round(y, 5)] for x, y in line.coords]
            for x, y in coords:
                bbox = [min(bbox[0], x), min(bbox[1], y), max(bbox[2], x), max(bbox[3], y)]
            make, model = C.CAR_NAMES.get(car_dir, (car_dir, ""))
            groups[dongle].append({"route": route, "car_dir": car_dir, "make": make, "model": model, "date": qdates.get(rp), "n": len(coords), "pts": coords})
            n_pts += len(coords)
        out = {"version": 1, "generated": __import__("time").strftime("%Y-%m-%d"), "crs": "WGS84 [lon, lat] 5 dp", "simplify_tolerance_deg": tol,
               "source": "stage A gpsLocation 1 Hz -> 0.1 Hz -> RDP", "bbox": bbox, "n_routes": sum(len(v) for v in groups.values()), "n_points": n_pts,
               "dongles": [{"dongle": d, "n_routes": len(groups[d]), "routes": groups[d]} for d in SHOWCASE_DONGLES if groups.get(d)]}
        size = C.write_json(os.path.join(site, "routes_map.json"), out)
        if size <= max_bytes or tol > 0.01:
            break
        tol *= 1.5
    print(f"routes_map.json {size} B: {out['n_routes']} routes, {n_pts} points, tolerance {tol:.5f} deg, bbox {bbox}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--site", default=os.path.join(C.SITE_DIR, "can"))
    ap.add_argument("--only", choices=["dongles", "signals", "map"])
    args = ap.parse_args()
    os.makedirs(args.site, exist_ok=True)
    if args.only in (None, "dongles"):
        build_dongles(args.site)
    if args.only in (None, "signals"):
        build_signals(args.site)
    if args.only in (None, "map"):
        build_map(args.site)


if __name__ == "__main__":
    main()
