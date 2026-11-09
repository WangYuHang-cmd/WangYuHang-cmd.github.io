#!/usr/bin/env python3
"""CANTraj project page · chart data for the eleven custom charts (table/1 files; WP-A part 2, SPEC §3.3).

Imported by cantraj_export.py as `import cantraj_charts_data as CD; CD.export_all(put)` (between signals() and bars()):
`put(key, filename, obj, first_view=False)` writes <REPO>/cantraj/static/data/<filename> through common.write_json (privacy gate)
and records the manifest entry. Standalone, for testing without the orchestrator (writes to WORK/_scratch/wpa2/data/):

    cd REPO && PYTHONPATH=PAPER/src CANTRAJ_BENCH=BENCH CANTRAJ_GPS=GPS CANTRAJ_MANIFESTS=PAPER/manifests CANTRAJ_HF=HF \
      CANTRAJ_WORK=WORK VENV_PY tools/projpipe/cantraj_charts_data.py [--skip-cdf] [--only board,cdf,…] [--out DIR]

Sources: the paper's result tables (reports/*/tables/*.csv, figures_data/*.csv) and, for the distribution curves, the per-episode
scores of benchmark v1.1 (the run id is named only in a constant here and never written to an output). Every file is columnar
(cols, n, meta with axes, units, series in legend order carrying slot / style / marker from the identity table of SPEC §2.2),
rounded as §3.3 states, and its row count and spot values are asserted before the object is handed to put(). The §0.2 regex is
applied to the serialised text of every object; nothing here names a place, a coordinate, a raw identifier, a venue or a review status.
The paper project is imported read-only (sys.dont_write_bytecode); its expected-episode rule (icde_tables.expected) and curve code
(icde_figures.ade_vector) are reused, not re-implemented."""
import os, sys, glob, json, re, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import write_json, dumps, num, nums
import numpy as np
import pandas as pd

sys.dont_write_bytecode = True           # the paper project is read-only: no __pycache__ writes from importing its modules
PAPER = os.environ.get("CANTRAJ_PAPER", "/home/henry/Desktop/Drive/DriveDNA/GPS")
HF = os.environ.get("CANTRAJ_HF", "/data/backup/DriveDNA-GPS_hf")
BENCH = os.environ.get("CANTRAJ_BENCH", "/data/backup/DriveDNA-GPS_bench")
WORK = os.environ.get("CANTRAJ_WORK", "/home/henry/Desktop/Drive/web_showcase_proj/cantraj")
sys.path.insert(0, os.path.join(PAPER, "src")); sys.path.insert(0, os.path.join(PAPER, "scripts"))
import icde_tables as T   # noqa: E402  (MAIN, FOLDS, expected(): the paper's expected-episode rule)
import icde_figures as F  # noqa: E402  (CDF_PANELS, LABEL_Y, HORIZON_PANELS, ade_vector(): the paper's own curve code)

RUN = "icde_v11"                                         # benchmark v1.1 (2026-10-28); appears in no output
TODAY, BENCHMARK = "2026-11-09", "benchmark v1.1 (2026-10-28)"
TABLES = os.path.join(PAPER, "reports", "icde", "tables"); FIGDATA = os.path.join(PAPER, "reports", "icde", "figures_data")
FOLDS = ["test", "few_shot_heldout"]
FORBID = re.compile(r"icde|submission|anonymous|device|/home/|/data/", re.I)   # SPEC §0.2 / §3.0, on the serialised text
JSON_CAP = 400_000
KEYS = ["board", "cdf", "horizon", "robust", "topk", "taxonomy", "gains", "cost", "agent", "density", "confidence"]   # §3.13 order

# ---------------------------------------------------------------- identity table (SPEC §2.2): stem prefix → key, label, slot, style, marker
# slot 0 = --ct-mute hatched (class F reference rows). Protocol variants of one stem share the identity; seeds (…_s0/_s1/_s2) share it too.
IDENTITY = [
    ("p0_hold", "hold", "hold start", 8, "nomap", None),
    ("dr_none", "straight", "straight line (speed)", 1, "nomap", None),
    ("prior", "prior", "start prior (speed)", 1, "nomap", None),
    ("retrieval", "retrieval", "route retrieval (speed)", 1, "nomap", None),
    ("dr_steer_offonline", "dr_steer_offonline", "steering DR, online offset", 2, "nomap", None),
    ("dr_steer_calib", "dr_steer_calib", "steering DR, train calibrated", 2, "nomap", None),
    ("dr_steer", "dr_steer", "steering DR, nominal", 2, "nomap", None),
    ("learned_gru", "gru", "learned GRU (3 seeds)", 2, "nomap", None),
    ("learned_resid", "resid", "learned physics residual (3 seeds)", 2, "nomap", None),
    ("map_pf_none", "pf_speed", "map filter, speed only", 1, "online", None),
    ("map_pf_steer_lineage", "lineage", "map filter, best-lineage read-out", 2, "lineage", None),
    ("map_pf_steer_n500", "pf_n500", "map filter, 500 particles", 2, "online", None),      # cost-table variant (§3.3 cost labels)
    ("map_pf_steer", "pf", "map filter, speed + steering", 2, "online", None),
    ("map_pf_learned_gru", "pf_gru", "map filter, learned GRU motion", 2, "online", None),
    ("map_pf_learned_resid", "pf_resid", "map filter, learned residual motion", 2, "online", None),
    ("map_beam_none", "beam_speed", "map beam, speed only", 1, "offline", None),
    ("map_beam_steer_b50", "beam_b50", "map beam, B = 50", 2, "offline", None),
    ("map_beam_steer", "beam", "map beam, speed + steering", 2, "offline", None),
    ("macrotracking_calib", "macro_calib", "MacroTracking, train calibrated", 4, "pub", "circle"),
    ("macrotracking", "macro", "MacroTracking", 4, "pub", "circle"),
    ("opd2_online", "opd2_online", "OPD-II, online read-out", 5, "pub", "square"),
    ("opd2", "opd2", "OPD-II (3 s delayed)", 5, "pub", "square"),
    ("elastic_pathing_hp", "ep_hp", "Elastic Pathing (start heading used)", 6, "pub", "tri-up"),
    ("elastic_pathing", "ep", "Elastic Pathing", 6, "pub", "tri-up"),
    ("dewri_hp", "dewri_hp", "Dewri et al. (start heading used)", 7, "pub", "tri-down"),
    ("dewri", "dewri", "Dewri et al.", 7, "pub", "tri-down"),
    ("spy_hp", "spy_hp", "SPy, start known (heading used)", 3, "pub", "diamond"),
    ("spy_area", "spy_area", "SPy, 5 km area", 3, "pub", "diamond"),
    ("spy", "spy", "SPy, start known", 3, "pub", "diamond"),
    ("can_trace_area", "ct_area", "CAN-Trace (pedal subset), 5 km area", 8, "pub", "cross"),
    ("can_trace", "ct", "CAN-Trace (pedal subset), start known", 8, "pub", "cross"),
    ("dr_curvature", "classF_dr", "curvature DR (class F, not CAN-only)", 0, "nomap", None),
    ("map_pf_curvature", "classF_pf", "map filter, curvature (class F)", 0, "online", None),
]
_ID_SORTED = sorted(IDENTITY, key=lambda r: -len(r[0]))
SLOTS, STYLES, MARKERS = set(range(9)), {"online", "offline", "nomap", "pub", "lineage", None}, {"circle", "square", "tri-up", "tri-down", "diamond", "cross", None}
SLOT_LEGEND = [(1, "speed only"), (2, "speed + steering"), (3, "steering only (SPy)"), (4, "MacroTracking"), (5, "OPD-II"), (6, "Elastic Pathing"),
               (7, "Dewri et al."), (8, "CAN-Trace · hold start")]        # V06 legend: identity colour per slot (marks are circles)


def ident(stem):
    base = stem.split("__")[0]
    for prefix, key, label, slot, style, marker in _ID_SORTED:
        if base == prefix or base.startswith(prefix + "_"):
            return {"key": key, "label": label, "slot": slot, "style": style, "marker": marker}
    raise KeyError(f"no identity for stem {stem}")


def ident_cols(stems, fields=("key", "label", "slot", "style", "marker")):
    ids = [ident(s) for s in stems]
    return {f: [i[f] for i in ids] for f in fields}


def series_meta(stems, markers=None, labels=None):
    """Legend entries in first-appearance order, one per identity key (markers / labels may be overridden per stem)."""
    out, seen = [], set()
    for k, s in enumerate(stems):
        i = ident(s)
        if markers is not None: i["marker"] = markers[k]
        if labels is not None: i["label"] = labels[k]
        if i["key"] not in seen: seen.add(i["key"]); out.append(i)
    return out


# ---------------------------------------------------------------- helpers
def r1(a): return nums(a, 1)
def r2(a): return nums(a, 2)
def r3(a): return nums(a, 3)
def r4(a): return nums(a, 4)
def ints(a): return [num(v, 0) for v in a]
def strs(a): return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else str(v) for v in a]
def bools(a): return [bool(v) for v in a]
def csv(name): return pd.read_csv(os.path.join(TABLES, name))
def one(df, **cond):
    m = np.ones(len(df), dtype=bool)
    for k, v in cond.items(): m &= (df[k] == v).to_numpy()
    r = df[m]; assert len(r) == 1, f"{cond}: {len(r)} rows"; return r.iloc[0]


def where(cols, **cond):
    n = len(next(iter(cols.values())))
    idx = [i for i in range(n) if all(cols[k][i] == v for k, v in cond.items())]
    assert len(idx) == 1, f"{cond}: {len(idx)} rows"
    return idx[0]


def spot(cols, cond, **want):
    """Assert the §3.3 spot values on the rounded columns (None ↔ null)."""
    i = where(cols, **cond)
    for k, v in want.items():
        got = cols[k][i]
        ok = (got is None and v is None) or (got is not None and v is not None and math.isclose(got, v, abs_tol=1e-9))
        assert ok, f"spot {cond} {k}: got {got}, want {v}"


def table(key, caption, cols, meta):
    lens = {k: len(v) for k, v in cols.items()}
    assert len(set(lens.values())) == 1, f"{key}: ragged columns {lens}"
    m = {"generated": TODAY, "source": meta.pop("source"), "benchmark": BENCHMARK}
    m.update(meta)
    return {"schema": "table/1", "id": key, "caption": caption, "n": next(iter(lens.values())), "cols": cols, "meta": m}


def gate(key, obj):
    """§3.0 / §3.13 checks on the finished object: schema, n = every column length, identity values, privacy regex, size, no NaN."""
    assert obj["schema"] == "table/1" and obj["id"] == key
    for c, v in obj["cols"].items(): assert isinstance(v, list) and len(v) == obj["n"], f"{key}.cols.{c}: {len(v)} ≠ n {obj['n']}"
    for c, allowed in (("slot", SLOTS), ("style", STYLES), ("marker", MARKERS)):
        bad = set(obj["cols"].get(c, [])) - allowed
        assert not bad, f"{key}.cols.{c}: {bad} not in the §2.2 table"
    for s in obj["meta"].get("series") or []:
        assert set(s) == {"key", "label", "slot", "style", "marker"} and s["slot"] in SLOTS and s["style"] in STYLES and s["marker"] in MARKERS, s
    text = dumps(obj)                                  # allow_nan=False: NaN/inf would raise here
    hit = FORBID.search(text)
    assert not hit, f"{key}: forbidden string {hit.group(0)!r} in output"
    assert len(text.encode("utf8")) <= JSON_CAP, f"{key}: {len(text)} B > {JSON_CAP}"
    return text


# ---------------------------------------------------------------- scores and manifest for the distribution curves (mirror icde_tables.load / icde_figures.main)
def load_scores():
    """Per-episode scores of the benchmark run (released copy first), the five columns the curves need."""
    for root in (os.path.join(HF, "benchmark", "scores"), T.paths.SCORES):
        f = os.path.join(root, RUN, "episodes_all.parquet")
        if os.path.exists(f):
            return pd.read_parquet(f, columns=["episode_id", "method", "protocol", "win", "ade"])
    raise SystemExit("per-episode scores of the benchmark run not found (CANTRAJ_HF / CANTRAJ_BENCH)")


def load_man():
    """The expected-episode manifest exactly as icde_tables.load() builds it (that function also loads the full score table)."""
    M = T.paths.MANIFESTS
    man = pd.read_parquet(os.path.join(M, "episode_manifest_v1.parquet"), columns=["episode_id", "driver", "drive", "fold", "win", "eligible_main"])
    me = pd.read_parquet(os.path.join(M, "episode_map_v11.parquet"), columns=["episode_id", "map_ok"])
    aw = pd.read_parquet(os.path.join(M, "availability_wide.parquet"))
    man = man[man.eligible_main & man.fold.isin(list(T.FOLDS))].merge(me, on="episode_id", how="left").merge(aw, on=["driver", "drive"], how="left")
    man["map_ok"] = man.map_ok.fillna(False).astype(bool)
    man["pedal_ok"] = man.gas == "valid"
    return man


# ================================================================ the eleven files
def board():
    """V06 · every row of main_board.csv, order kept (n = 188)."""
    t = csv("main_board.csv")
    assert len(t) == 188, len(t)
    cols = {"stem": strs(t.stem), "protocol": strs(t.protocol), "win": strs(t.win), "fold": strs(t.fold), "family": strs(t.family), "label": strs(t.label)}
    cols.update(ident_cols(t.stem, ("key", "slot", "style", "marker")))      # label stays the CSV row label (§3.3); identity columns from §2.2
    cols.update({"n_expected": ints(t.n_expected), "n_output": ints(t.n_output), "n_fail": ints(t.n_fail),
                 "ade_median": r1(t.ade_median), "ade_lo": r1(t.ade_lo), "ade_hi": r1(t.ade_hi), "ade_driver_median": r1(t.ade_driver_median),
                 "c100": r3(t.c100), "route_ok": r3(t.route_ok), "tail_lost100": r3(t.tail_lost100), "terminal_lost100": r3(t.terminal_lost100),
                 "n_seeds": ints(t.n_seeds), "is_reference": [f == "reference" for f in cols["family"]]})
    families = list(dict.fromkeys(cols["family"]))
    assert families == ["no map, online", "map, online", "map, offline", "map, heading unknown", "reference"], families
    assert set(cols["win"]) == {"w05", "w15", "full"} and set(cols["fold"]) == set(FOLDS)
    assert all((s == 0) == ref for s, ref in zip(cols["slot"], cols["is_reference"]))
    slots = sorted({s for s in cols["slot"] if s})
    assert slots == list(range(1, 9)), slots
    assert cols["label"] == strs(t.label) and cols["label"][where(cols, stem="map_beam_steer__G3", protocol="F-M-Hp", win="w05", fold="test")] == "map beam, steering"
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", win="w05", fold="test"), ade_median=36.5, ade_lo=23.9, ade_hi=54.3, route_ok=0.876)
    spot(cols, dict(stem="map_pf_steer__G3", protocol="O-M-Hp", win="w05", fold="test"), ade_median=42.7, ade_lo=28.6, ade_hi=59.3, route_ok=0.871)
    spot(cols, dict(stem="opd2__G3", win="w05", fold="test"), ade_median=42.3, route_ok=0.789)
    spot(cols, dict(stem="elastic_pathing_hp__G1", win="w05", fold="test"), ade_median=87.2, n_fail=89)
    spot(cols, dict(stem="can_trace__G2", win="w05", fold="test"), ade_median=None, n_expected=245, n_fail=243)
    meta = {"source": "main_board.csv",
            "units": {"ade_median": "m", "ade_lo": "m", "ade_hi": "m", "ade_driver_median": "m", "c100": "share", "route_ok": "share",
                      "tail_lost100": "share", "terminal_lost100": "share"},
            "axes": {"x": "median ADE (m, log scale)", "y": "method, grouped by family"},
            "series": [{"key": f"slot{s}", "label": lab, "slot": s, "style": None, "marker": None} for s, lab in SLOT_LEGEND if s in slots],
            "notes": ["one row per method stem, protocol, window and fold; rows in the paper's board order",
                      "ade_median, ade_lo, ade_hi: failure-aware median ADE with the 95 % driver-bootstrap interval; missing outputs count as infinite ADE (null = no finite median)",
                      "ade_driver_median: each driver summarised first, then the median over drivers",
                      "c100: share of seconds within 100 m; route_ok: path recall at 50 m ≥ 0.8; tail_lost100 / terminal_lost100: share of windows lost after a point / at the end",
                      "n_seeds = 3 for learned rows (seed average); is_reference: class F rows use GPS-informed software outputs (slot 0, hatched grey)",
                      "series is the colour legend by slot; marks are circles; label = the paper's row label"],
            "families": families, "wins": {"w05": "5 min", "w15": "15 min", "full": "whole drive"}, "x_domain": [10, 20000],
            "full_duration_median_min": {"test": 19, "few_shot_heldout": 11}}
    return table("board", "Median five-minute, fifteen-minute and whole-drive ADE with 95 % driver-bootstrap intervals, route recovery and c100 for every benchmark row, per evaluation fold.", cols, meta)


def cdf():
    """V07 · 15 panel series × 2 folds (n = 30): failure-aware five-minute ADE quantiles at shares 0.005 … 1.000, mirroring fig_cdf()."""
    ep, man = load_scores(), load_man()
    req_of = {(m[1], m[2]): (m[5], m[6]) for m in T.MAIN if isinstance(m[1], str)}
    panels = [(title, [tuple(k) for k in keys]) for title, keys in F.CDF_PANELS]
    assert [p[0] for p in panels] == ["speed vs steering, same decoders", "published methods", "start heading unknown"] and sum(len(k) for _, k in panels) == 15
    ref = pd.read_csv(os.path.join(FIGDATA, "fig_cdf.csv"))
    shares = np.arange(1, 201) / 200.0
    C = {k: [] for k in ("panel", "stem", "protocol", "fold", "key", "label", "slot", "style", "marker", "n", "fail", "median", "q")}
    for title, keys in panels:
        for stem, proto in keys:
            req, hp = req_of[(stem, proto)]
            idn = ident(stem)
            for fold in FOLDS:
                v = F.ade_vector(ep, man, stem, proto, "w05", req, hp, folds=(fold,))
                x = np.sort(v.ade.to_numpy(dtype=float)); n = len(x); fail = int((~np.isfinite(x)).sum())
                assert n == {"test": 1917}.get(fold, n) and (fold == "test" or n in (1959, 1963)), (stem, proto, fold, n)
                idx = np.clip(np.ceil(shares * n - 1e-9).astype(int) - 1, 0, n - 1)   # smallest ADE whose empirical share ≥ s
                q = [num(x[i], 1) for i in idx]
                fin = [z for z in q if z is not None]
                assert fin == sorted(fin) and (q[-1] is None) == (fail > 0) and len(fin) == sum(1 for i in idx if i < n - fail)
                med = float(np.median(x))
                if fold == "test":
                    rr = one(ref, panel=title, stem=stem, protocol=proto)
                    assert int(rr.n) == n and int(rr.fail) == fail and round(float(rr["median"]), 1) == round(med, 1), (stem, proto, rr.to_dict(), n, fail, med)
                for k, val in (("panel", title), ("stem", stem), ("protocol", proto), ("fold", fold), ("key", idn["key"]), ("label", idn["label"]),
                               ("slot", idn["slot"]), ("style", idn["style"]), ("marker", idn["marker"]), ("n", n), ("fail", fail), ("median", num(med, 1)), ("q", q)):
                    C[k].append(val)
    assert len(C["stem"]) == 30
    spot(C, dict(panel="speed vs steering, same decoders", stem="dr_steer__G3", fold="test"), median=921.3, fail=0)
    spot(C, dict(panel="speed vs steering, same decoders", stem="map_beam_steer__G3", fold="test"), median=36.5)
    spot(C, dict(panel="published methods", stem="elastic_pathing_hp__G1", fold="test"), median=87.2, fail=89)
    spot(C, dict(panel="published methods", stem="spy_hp__G3", fold="test"), median=1473.7, fail=5)
    spot(C, dict(panel="start heading unknown", stem="map_beam_none__G1", fold="test"), median=1314.2)
    spot(C, dict(panel="start heading unknown", stem="elastic_pathing__G1", fold="test"), median=129.1, fail=62)
    spot(C, dict(panel="start heading unknown", stem="dewri__G1", fold="test"), median=292.7, fail=8)
    meta = {"source": "episodes_all.parquet (per-episode scores of the benchmark run), fig_cdf.csv (check values)",
            "units": {"median": "m", "q": "m"}, "axes": {"x": "five-minute ADE (m, log scale)", "y": "share of expected windows"},
            "series": series_meta(C["stem"]),
            "notes": ["q[i] is the ADE below which share (i + 1) × 0.005 of the expected windows fall (failure-aware: an expected window without output counts as infinite ADE)",
                      "q is null once the share exceeds the output share 1 − fail / n, so a curve ends there",
                      "n: expected windows of the fold for that method and protocol (map protocols drop windows without map coverage); median: failure-aware median ADE",
                      "the same identity key appears in more than one panel (the map filter in panels 1 and 2; panel 3 is the heading-unknown protocol)"],
            "share_step": 0.005, "x_domain": [5, 30000], "label_y": list(F.LABEL_Y), "panels": [p[0] for p in panels],
            "n_windows": {"test": 1917, "few_shot_heldout": 1963}}
    return table("cdf", "Distribution of the five-minute ADE per method and fold; expected windows without output stay in the denominator, so a curve ends at one minus the failure rate.", C, meta)


def horizon():
    """V08 · 13 series × 3 horizons × 2 folds (n = 78) from cohort_horizon.csv filtered as fig_horizon(), both folds."""
    t = csv("cohort_horizon.csv")
    t = t[~((t.horizon_s == 900) & (t.source == RUN) & t.protocol.str.startswith("O-"))]
    panels = [(title, [tuple(k) for k in keys]) for title, keys in F.HORIZON_PANELS]
    assert panels == [("online, start heading known", [("map_pf_steer__G3", "O-M-Hp"), ("map_pf_none__G1", "O-M-Hp"), ("macrotracking__G3", "O-M-Hp"), ("opd2_online__G3", "O-M-Hp"), ("dr_steer__G3", "O-N-Hp")]),
                      ("offline, start heading known", [("map_beam_steer__G3", "F-M-Hp"), ("map_beam_none__G1", "F-M-Hp"), ("map_pf_steer_lineage__G3", "F-M-Hp"), ("elastic_pathing_hp__G1", "F-M-Hp")]),
                      ("start heading unknown", [("map_pf_steer__G3", "O-M-Hm"), ("map_beam_steer__G3", "F-M-Hm"), ("map_beam_none__G1", "F-M-Hm"), ("elastic_pathing__G1", "F-M-Hm")])], panels

    def source_label(src, h):   # the raw run ids carry a venue word (§0.2): describe the scoring instead
        if src.startswith("icde_cohort_online_p"): return f"online 15-minute run scored at {h} s"
        if src.startswith("icde_cohort_p"): return f"offline rerun on the {h} s prefix"
        if src == RUN: return BENCHMARK + ", 15-minute run"
        raise ValueError(src)
    rows = []
    for title, keys in panels:
        for stem, proto in keys:
            for fold in FOLDS:
                for h in (60, 300, 900):
                    r = one(t, method=stem, protocol=proto, fold=fold, horizon_s=h)
                    rows.append(dict(panel=title, stem=stem, protocol=proto, fold=fold, horizon_s=h, source=source_label(r.source, h), n=int(r.n), n_output=int(r.n_output),
                                     n_drivers=int(r.n_drivers), ade_median=num(r.ade_median, 1), ade_lo=num(r.ade_lo, 1), ade_hi=num(r.ade_hi, 1), route_ok=num(r.route_ok, 3)))
    assert len(rows) == 78
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    cols.update(ident_cols(cols["stem"]))
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", fold="test", horizon_s=60), ade_median=16.7)
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", fold="test", horizon_s=300), ade_median=44.4)
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", fold="test", horizon_s=900), ade_median=302.9)
    spot(cols, dict(stem="map_pf_steer__G3", protocol="O-M-Hp", fold="test", horizon_s=60), ade_median=19.0)
    spot(cols, dict(stem="map_pf_steer__G3", protocol="O-M-Hp", fold="test", horizon_s=300), ade_median=56.0)
    spot(cols, dict(stem="map_pf_steer__G3", protocol="O-M-Hp", fold="test", horizon_s=900), ade_median=672.1)
    spot(cols, dict(stem="opd2_online__G3", fold="test", horizon_s=60), ade_median=11.1)
    spot(cols, dict(stem="opd2_online__G3", fold="test", horizon_s=300), ade_median=48.1)
    spot(cols, dict(stem="opd2_online__G3", fold="test", horizon_s=900), ade_median=1316.3)
    spot(cols, dict(stem="elastic_pathing__G1", protocol="F-M-Hm", fold="test", horizon_s=900), ade_median=3335.1, n_output=194)
    p = csv("cohort_pairs.csv")
    p = p[p.comparison.isin(["beam vs PF", "beam vs PF lineage"])]
    pairs = [{"comparison": r["comparison"], "horizon_s": int(r["horizon_s"]), "fold": r["fold"], "n": int(r["n"]), "median": num(r["median"], 1), "median_lo": num(r["median_lo"], 1),
              "median_hi": num(r["median_hi"], 1), "mean": num(r["mean"], 1), "mean_lo": num(r["mean_lo"], 1), "mean_hi": num(r["mean_hi"], 1), "win_a": num(r["win_a"], 3)}
             for r in p.to_dict("records")]
    assert len(pairs) == 12 and {(q["comparison"], q["horizon_s"], q["fold"]) for q in pairs} == {(c, h, f) for c in ("beam vs PF", "beam vs PF lineage") for h in (60, 300, 900) for f in FOLDS}
    bp = [q for q in pairs if q["comparison"] == "beam vs PF" and q["horizon_s"] == 900 and q["fold"] == "test"][0]
    assert (bp["median"], bp["median_lo"], bp["median_hi"], bp["mean"], bp["mean_lo"], bp["mean_hi"]) == (-3.1, -6.1, -1.6, -551.7, -1421.0, -98.6), bp
    meta = {"source": "cohort_horizon.csv, cohort_pairs.csv",
            "units": {"horizon_s": "s", "ade_median": "m", "ade_lo": "m", "ade_hi": "m", "route_ok": "share"},
            "axes": {"x": "minutes after the start (1, 5, 15; log-spaced)", "y": "median ADE (m, log scale)"},
            "series": series_meta(cols["stem"]),
            "notes": ["the same cohort of drives, one start each, scored 1, 5 and 15 minutes after the start; online methods are scored on prefixes of their 15-minute runs, offline methods are rerun on each prefix with only its signals and map",
                      "ade_lo / ade_hi: 95 % driver-resampling interval of the median; missing outputs count as infinite ADE (n_output < n)",
                      "pairs: paired differences a − b on the cohort windows (median and mean with 95 % intervals, win_a = share of windows where a is better); the beam avoids some of the filter's largest failures",
                      "source describes the scoring of each row (prefix scoring of the online run, prefix rerun of the offline method, or the benchmark's 15-minute run)"],
            "cohort": {"test": {"drives": 205, "drivers": 37}, "few_shot_heldout": {"drives": 221, "drivers": 44}}, "pairs": pairs, "y_domain": [5, 20000],
            "panels": [p_[0] for p_ in panels], "horizons_s": [60, 300, 900]}
    assert all(r["n"] == meta["cohort"][r["fold"]]["drives"] and r["n_drivers"] == meta["cohort"][r["fold"]]["drivers"] for r in rows)
    return table("horizon", "The same cohort of drives, one start each, scored 1, 5 and 15 minutes after the start: median ADE with driver-resampling 95 % bands, per fold.", cols, meta)


ROBUST_TAGS = {"steer": ["sq2", "sq5", "sq10", "sq20", "s1hz", "s02hz", "sn2", "sn5", "sd05"], "speed": ["pq1", "pq2", "pq5", "v1hz"]}
TAG_LABEL = {"sq2": "2°", "sq5": "5°", "sq10": "10°", "sq20": "20°", "s1hz": "1 Hz", "s02hz": "0.2 Hz", "sn2": "±2°", "sn5": "±5°", "sd05": "0.5 s delay",
             "pq1": "1 m/s", "pq2": "2 m/s", "pq5": "5 m/s", "v1hz": "1 Hz"}
ROBUST_MARKER = {"pf": "circle", "beam": "square", "beam_speed": "diamond"}     # V09-local markers (§3.3)


def robust():
    """V09 · fig_robust.csv (60 rows, both folds) joined to robustness_map_w05.csv for the medians and the level text."""
    f = pd.read_csv(os.path.join(FIGDATA, "fig_robust.csv"))
    r = csv("robustness_map_w05.csv")[["stem", "fold", "tag", "perturbation", "n_expected", "median_clean", "median_pert"]]
    m = f.merge(r, on=["stem", "fold", "tag"], how="left", validate="1:1")
    assert len(m) == 60 and m.perturbation.notna().all() and set(m.panel) == {"steer", "speed"}
    assert all(tag in ROBUST_TAGS[p] for p, tag in zip(m.panel, m.tag))
    cols = {"panel": strs(m.panel), "stem": strs(m.stem), "fold": strs(m.fold), "tag": strs(m.tag), "tag_label": [TAG_LABEL[t] for t in m.tag],
            "tag_order": [ROBUST_TAGS[p].index(t) for p, t in zip(m.panel, m.tag)], "probe": [t == "sd05" for t in m.tag], "perturbation": strs(m.perturbation),
            "route_diff_pp": r2(m.route_diff_pp), "lo_pp": r2(m.lo_pp), "hi_pp": r2(m.hi_pp), "route_clean": r3(m.route_clean), "route_pert": r3(m.route_pert),
            "median_clean": r1(m.median_clean), "median_pert": r1(m.median_pert), "n_expected": ints(m.n_expected)}
    cols.update(ident_cols(m.stem, ("key", "label", "slot")))
    cols["marker"] = [ROBUST_MARKER[k] for k in cols["key"]]
    assert set(cols["key"]) == {"pf", "beam", "beam_speed"}
    spot(cols, dict(stem="map_pf_steer__G3", fold="test", tag="sq20"), route_diff_pp=-1.36, lo_pp=-2.5, hi_pp=-0.41)
    spot(cols, dict(stem="map_beam_steer__G3", fold="few_shot_heldout", tag="s1hz"), route_diff_pp=1.33, lo_pp=0.77, hi_pp=2.01)
    spot(cols, dict(stem="map_pf_steer__G3", fold="few_shot_heldout", tag="pq5"), route_diff_pp=-7.55)
    spot(cols, dict(stem="map_beam_steer__G3", fold="test", tag="pq5"), route_diff_pp=-3.34, median_clean=36.5, median_pert=105.3)
    stems = ["map_pf_steer__G3", "map_beam_steer__G3", "map_beam_none__G1"]
    meta = {"source": "fig_robust.csv, robustness_map_w05.csv",
            "units": {"route_diff_pp": "pp", "lo_pp": "pp", "hi_pp": "pp", "route_clean": "share", "route_pert": "share", "median_clean": "m", "median_pert": "m"},
            "axes": {"x": "degradation level (tag_order within each panel)", "y": "change in five-minute route recovery against the clean signal (percentage points)"},
            "series": series_meta(stems, markers=[ROBUST_MARKER[ident(s)["key"]] for s in stems]),
            "notes": ["fixed map attacks on degraded inputs; every level fixed before the first run; none of the attacks was re-tuned on the degraded signals",
                      "route_diff_pp = 100 × (route_pert − route_clean) on the same expected windows, with the 95 % driver-clustered interval lo_pp … hi_pp",
                      "both folds are rows (filled = test, hollow = few-shot in the chart); the 0.5 s delay (probe = true) is a timing probe",
                      "the speed-only beam does not use steering, so it has rows on the speed levels only; markers here are chart-local (circle, square, diamond)",
                      "steering dead reckoning without a map shifts by at most 0.4 m under the same levels (dr_sensitivity_max_m)"],
            "tag_order": ROBUST_TAGS, "y_domain": [-11, 4], "dr_sensitivity_max_m": 0.4}
    return table("robust", "Change in five-minute route recovery of the fixed map attacks under degraded steering and speed inputs, against the clean signal on the same windows (percentage points, 95 % driver-clustered intervals), both folds.", cols, meta)


TOPK_PANELS = [("start heading known", [("map_beam_none__G1", "F-M-Hp"), ("map_beam_steer__G3", "F-M-Hp"), ("elastic_pathing_hp__G1", "F-M-Hp"), ("dewri_hp__G1", "F-M-Hp")]),
               ("start heading unknown", [("map_beam_none__G1", "F-M-Hm"), ("map_beam_steer__G3", "F-M-Hm"), ("elastic_pathing__G1", "F-M-Hm"), ("dewri__G1", "F-M-Hm")])]


def topk():
    """V10a · 4 series × 2 panels × 2 folds (n = 16) from topk_w05.csv (fig_topk.csv holds the test rows: checked)."""
    t, ref = csv("topk_w05.csv"), pd.read_csv(os.path.join(FIGDATA, "fig_topk.csv"))
    rows = []
    for title, keys in TOPK_PANELS:
        for stem, proto in keys:
            for fold in FOLDS:
                r = one(t, stem=stem, protocol=proto, fold=fold)
                if fold == "test":
                    rr = one(ref, panel=title, stem=stem, protocol=proto)
                    assert all(round(float(rr[f"top{K}"]), 1) == round(float(r[f"top{K}_ade_median"]), 1) for K in (1, 3, 5, 10)) and round(float(rr.best_first), 3) == round(float(r.best_rank_is_1), 3)
                rows.append(dict(panel=title, stem=stem, protocol=proto, fold=fold, top1=num(r.top1_ade_median, 1), top3=num(r.top3_ade_median, 1), top5=num(r.top5_ade_median, 1),
                                 top10=num(r.top10_ade_median, 1), best_first=num(r.best_rank_is_1, 3), n_expected=int(r.n_expected), n_output=int(r.n_output),
                                 n_single_path=int(r.n_single_path), n_candidates_median=num(r.n_candidates_median, 1)))
    assert len(rows) == 16
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    cols.update(ident_cols(cols["stem"]))
    spot(cols, dict(stem="map_beam_none__G1", protocol="F-M-Hm", fold="test"), top1=1314.2, top3=209.7, top5=94.4, top10=72.0, best_first=0.207)
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hm", fold="test"), top1=41.4, top10=27.0, best_first=0.542)
    meta = {"source": "topk_w05.csv, fig_topk.csv",
            "units": {"top1": "m", "top3": "m", "top5": "m", "top10": "m", "best_first": "share"},
            "axes": {"x": "K (candidate paths, in rank order)", "y": "median ADE of the lowest-error path among the K highest-ranked candidate paths (m, log scale)"},
            "series": series_meta(cols["stem"]),
            "notes": ["failure-aware medians: an expected window without output counts as infinite ADE; a single-path output is its own top-K (n_single_path)",
                      "best_first: share of outputs whose best candidate is ranked first; n_candidates_median: median number of candidates per output"],
            "K": [1, 3, 5, 10], "y_domain": [10, 3000], "panels": [p[0] for p in TOPK_PANELS]}
    return table("topk", "Median five-minute ADE of the lowest-error path among the K highest-ranked candidate paths for the offline searches with and without steering, with and without the start heading, per fold.", cols, meta)


def taxonomy():
    """V10b · the eight (stem, protocol) of topk × 2 folds at the 50 m threshold (n = 16) from window_taxonomy_w05.csv."""
    w = csv("window_taxonomy_w05.csv")
    w = w[w.threshold_m == 50]
    rows = []
    for title, keys in TOPK_PANELS:
        for stem, proto in keys:
            for fold in FOLDS:
                r = one(w, stem=stem, protocol=proto, fold=fold)
                rows.append(dict(stem=stem, protocol=proto, fold=fold, heading="known" if proto.endswith("Hp") else "unknown", n=int(r.n),
                                 top1_ok=num(r.top1_ok, 4), ranking_miss=num(r.ranking_miss, 4), no_candidate=num(r.no_candidate, 4), no_output=num(r.no_output, 4),
                                 n_top1_ok=int(r.n_top1_ok), n_ranking_miss=int(r.n_ranking_miss), n_no_candidate=int(r.n_no_candidate), n_no_output=int(r.n_no_output)))
                assert rows[-1]["n_top1_ok"] + rows[-1]["n_ranking_miss"] + rows[-1]["n_no_candidate"] + rows[-1]["n_no_output"] == rows[-1]["n"]
    assert len(rows) == 16
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    cols.update(ident_cols(cols["stem"], ("key", "label")))
    spot(cols, dict(stem="map_beam_none__G1", protocol="F-M-Hm", fold="test"), top1_ok=0.1815, ranking_miss=0.24, no_candidate=0.5785, no_output=0)
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", fold="test"), top1_ok=0.6145, ranking_miss=0.1038, no_candidate=0.2817, no_output=0)
    meta = {"source": "window_taxonomy_w05.csv",
            "units": {"top1_ok": "share", "ranking_miss": "share", "no_candidate": "share", "no_output": "share"},
            "axes": {"x": "share of five-minute windows", "y": "method × start heading"},
            "series": [],
            "notes": ["the four parts of every row sum to 1 (counts sum to n); threshold 50 m",
                      "top1_ok: the top-1 candidate is within 50 m; ranking_miss: a lower-ranked candidate is (ranking failure); no_candidate: none is (search failure); no_output: nothing returned",
                      "single-series chart: identity comes from the row label; parts use the ordinal ramp (meta.parts)"],
            "parts": [{"key": "top1_ok", "label": "top-1 within 50 m", "color": "--ct-ord-1"},
                      {"key": "ranking_miss", "label": "lower-ranked candidate within 50 m (ranking failure)", "color": "--ct-ord-2"},
                      {"key": "no_candidate", "label": "no candidate within 50 m (search failure)", "color": "--ct-ord-3"},
                      {"key": "no_output", "label": "no output", "color": "--ct-mute"}],
            "threshold_m": 50}
    return table("taxonomy", "Share of five-minute windows whose top-1 candidate is within 50 m, whose lower-ranked candidate is within 50 m (ranking failure), with no candidate within 50 m (search failure) or without output, per method and fold.", cols, meta)


GAIN_ROWS = [("steering | speed", "steering added to speed"), ("steering | speed+pedals", "steering added to speed + pedals"), ("pedals | speed", "pedals added to speed"),
             ("pedals | speed+steering", "pedals added to speed + steering"), ("pressed flags | speed", "pressed flags added to speed"),
             ("pressed flags | speed+steering", "pressed flags added to speed + steering")]
SIG_SETS = [("S1", "speed"), ("S2c", "speed + pedal"), ("S2b", "speed + pressed flags"), ("S3", "speed + steering"), ("S4c", "speed + steering + pedal"), ("S4b", "speed + steering + pressed flags")]


def gains():
    """V11 · the 28 paired rows of signal_gains_w05.csv (map and no map, per seed); meta.sets from signal_sets_w05.csv (map, seed means)."""
    g, s = csv("signal_gains_w05.csv"), csv("signal_sets_w05.csv")
    assert len(g) == 28 and set(g.added) == {a for a, _ in GAIN_ROWS}
    order = {a: i for i, (a, _) in enumerate(GAIN_ROWS)}; label = dict(GAIN_ROWS)
    g = g.assign(_set=g.setting.map({"map": 0, "no map": 1}), _ord=g.added.map(order)).sort_values(["_set", "_ord", "seed"], kind="stable")
    cols = {"setting": strs(g.setting), "comparison": strs(g.added), "row_label": [label[a] for a in g.added], "row_order": [order[a] for a in g.added], "a": strs(g.a), "b": strs(g.b),
            "seed": ints(g.seed), "n": ints(g.n), "n_drivers": ints(g.n_drivers), "median": r1(g["median"]), "median_lo": r1(g.median_lo), "median_hi": r1(g.median_hi),
            "mean": r1(g["mean"]), "mean_lo": r1(g.mean_lo), "mean_hi": r1(g.mean_hi), "win_a": r3(g.win_a)}
    assert set(cols["n"]) == {407} and set(cols["n_drivers"]) == {31}
    for seed, want in ((0, -119.5), (1, -233.7), (2, -147.0)):
        spot(cols, dict(setting="map", comparison="steering | speed", seed=seed), median=want)
        i = where(cols, setting="map", comparison="steering | speed", seed=seed); assert cols["median_hi"][i] < 0
    for seed, want in ((0, 0.9), (1, -4.8), (2, 6.1)):
        spot(cols, dict(setting="map", comparison="pedals | speed", seed=seed), median=want)
        i = where(cols, setting="map", comparison="pedals | speed", seed=seed); assert cols["median_lo"][i] < 0 < cols["median_hi"][i]
    sm = s[s.setting == "map"]
    sets = []
    for code, lab in SIG_SETS:
        r = sm[sm.group == code].sort_values("seed")
        assert len(r) in (1, 3), (code, len(r))
        sets.append({"set": code, "label": lab, "median_m": num(r.ade_median.mean(), 1), "seeds": r1(r.ade_median), "route": r3(r.route_ok)})
    assert [z["median_m"] for z in sets] == [338.8, 413.2, 351.1, 48.5, 41.7, 37.1] and sets[0]["seeds"] == [283.9, 420.6, 311.9], sets
    meta = {"source": "signal_gains_w05.csv, signal_sets_w05.csv",
            "units": {"median": "m", "median_lo": "m", "median_hi": "m", "mean": "m", "mean_lo": "m", "mean_hi": "m", "win_a": "share"},
            "axes": {"x": "paired median difference in five-minute ADE when the signal is added (m; negative = better)", "y": "comparison (row_order), one dot per training seed"},
            "series": [],
            "notes": ["paired on the same 407 five-minute windows of 31 evaluation drivers with a continuous accelerator signal; learner, decoder and drives fixed; 95 % driver-bootstrap intervals",
                      "median / mean: a − b where a is the set with the added signal; win_a: share of windows where a is better",
                      "the flag rows (pressed flags) have one seed; single-series chart (the row label is the identity); hollow dot = interval includes 0",
                      "sets: seed-mean median ADE of each signal set with the map (seeds and route recovery per seed)",
                      "this subset is harder for speed-based search than the full evaluation groups, so read the gains within the paired study"],
            "sets": sets, "x_domain": {"map": [-380, 40], "no map": [-950, 160]}, "rule": "a 95 % interval that includes 0 is no clear evidence either way",
            "shuffle": {"steer_ratio": [3.4, 3.8], "pedal_pct_speed": [-0.5, 9.2], "pedal_pct_steer": [4.2, 7.2]}, "n_windows": 407, "n_drivers": 31}
    return table("gains", "Paired median difference in five-minute ADE when one signal is added, learner, decoder and drives fixed (407 windows of 31 evaluation drivers, 95 % driver-bootstrap intervals, one row per training seed).", cols, meta)


COST_MAP = {"dewri": "dewri__G1", "dewri_hp": "dewri_hp__G1", "dr_none": "dr_none__G1", "dr_steer": "dr_steer__G3", "elastic_pathing": "elastic_pathing__G1",
            "elastic_pathing_hp": "elastic_pathing_hp__G1", "learned_gru": "learned_gru_s0__G3", "macrotracking": "macrotracking__G3", "map_beam_none": "map_beam_none__G1",
            "map_beam_steer": "map_beam_steer__G3", "map_beam_steer_b50": "map_beam_steer_b50__G3", "map_pf_learned": "map_pf_learned_gru_s0__G3", "map_pf_none": "map_pf_none__G1",
            "map_pf_steer": "map_pf_steer__G3", "map_pf_steer_n500": "map_pf_steer_n500__G3", "opd2": "opd2__G3", "spy": "spy__G3", "spy_area": "spy_area__G3", "spy_hp": "spy_hp__G3"}
COST_LABEL = {"gru": "learned GRU"}      # one seed was timed: the board's "(3 seeds)" qualifier does not apply here
SUBSET_VAL, SUBSET_PEDAL = "validation · 76 five-minute windows", "pedal-valid · 25 five-minute windows"


def cost():
    """V12 · cost.csv ⋈ cost_accuracy.csv (w05; 19 methods) + CAN-Trace 5 km area from cost_pedal.csv ⋈ cost_accuracy_pedal.csv (n = 20)."""
    c, ca = csv("cost.csv"), csv("cost_accuracy.csv"); ca = ca[ca.win == "w05"]
    cp, cap = csv("cost_pedal.csv"), csv("cost_accuracy_pedal.csv"); cap = cap[cap.win == "w05"]
    assert len(c) == 19 and set(c.tag) == set(COST_MAP)
    rows = []
    for tag, stem, subset, cc, acc in [(tag, COST_MAP[tag], SUBSET_VAL, one(c, tag=tag), one(ca, method=COST_MAP[tag])) for tag in c.tag] + \
                                      [("can_trace_area", "can_trace_area__G2", SUBSET_PEDAL, one(cp, tag="can_trace_area"), one(cap, method="can_trace_area__G2"))]:
        idn = ident(stem); idn["label"] = COST_LABEL.get(idn["key"], idn["label"])
        n_fail = int(cc.n_fail_w05); med = num(acc.ade_median, 1)
        assert int(cc.n_w05) == int(acc.n) and n_fail == int(acc.fail), (tag, cc.n_w05, acc.n, n_fail, acc.fail)
        rows.append(dict(tag=tag, stem=stem, **idn, protocol=str(acc.protocol), subset=subset, infer_median_s=num(cc.infer_median_s_w05, 3), infer_p90_s=num(cc.infer_p90_s_w05, 3),
                         n_w05=int(cc.n_w05), n_fail_w05=n_fail, ade_median=med, route=num(acc.route, 3), peak_rss_gb=num(cc.peak_rss_gb, 2), graph_build_s=num(cc.graph_build_median_s, 1),
                         hollow=n_fail > 0, pinned_top=med is None))
    assert len(rows) == 20
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    spot(cols, dict(tag="map_beam_steer"), infer_median_s=0.24, ade_median=21.1, route=0.842, hollow=False)
    spot(cols, dict(tag="map_pf_steer"), infer_median_s=0.573, ade_median=26.2, route=0.868)
    spot(cols, dict(tag="opd2"), infer_median_s=0.085, ade_median=23.4, route=0.763)
    spot(cols, dict(tag="spy_area"), infer_median_s=4.929, n_fail_w05=9, n_w05=76, hollow=True)
    spot(cols, dict(tag="can_trace_area"), n_w05=25, n_fail_w05=19, ade_median=None, pinned_top=True, hollow=True)
    mp = csv("map_prep_cost.csv")
    tiles_min = mp[mp.step.str.startswith("re-cut")].seconds.sum() / 60; valhalla_min = mp[mp.step.str.startswith("Valhalla")].seconds.sum() / 60
    assert round(tiles_min) == 46 and round(valhalla_min) == 44 and round(float(c.graph_build_median_s.median()), 1) == 2.6 and round(float(c.peak_rss_gb.max()), 1) == 2.1, (tiles_min, valhalla_min)
    meta = {"source": "cost.csv, cost_accuracy.csv, cost_pedal.csv, cost_accuracy_pedal.csv, map_prep_cost.csv",
            "units": {"infer_median_s": "s", "infer_p90_s": "s", "ade_median": "m", "route": "share", "peak_rss_gb": "GB", "graph_build_s": "s"},
            "axes": {"x": "median single-worker inference time per five-minute window (s, log scale)", "y": "median ADE (m, log scale) or route recovered (share)"},
            "series": series_meta(cols["stem"], labels=cols["label"]),
            "notes": ["one method at a time on a fixed validation subset; failed searches keep their elapsed time (hollow = at least one failure)",
                      "ade_median null = no finite median (CAN-Trace, 5 km area: 19 of 25 windows without output; pinned to the top edge); the start-known CAN-Trace variant (25 of 25 without output) is not timed here",
                      "peak_rss_gb: peak resident memory of the whole run; graph_build_s: median road-graph build per drive (null where no map is used)",
                      "timings are machine-specific; map preparation is a separate one-off cost (chips)"],
            "chips": [{"label": "road tiles re-cut (5,111 tiles)", "value": "46 min", "detail": "3.3 GB"},
                      {"label": "Valhalla graph for OPD-II (44 clusters)", "value": "44 min", "detail": "3.4 GB"},
                      {"label": "road graph per drive, median", "value": "2.6 s"},
                      {"label": "peak memory, any method", "value": "≤ 2.1 GB"}],
            "x_domain": [0.004, 10], "y_domain": [10, 5000], "note": "one workstation, 24 threads, one method at a time; failed searches keep their elapsed time"}
    return table("cost", "Median single-worker inference time per five-minute window against median ADE and route recovery on a fixed validation subset, one method at a time.", cols, meta)


AGENT_CONFIGS = [("A", "base", "beam", "map beam (A)", True, False), ("B", "base", "selector", "supervised selector (B)", True, False),
                 ("C", "base", "agent", "Qwen3-14B agent (C), three seeds pooled", True, False), ("O3", "base", "oracle", "pool oracle, three tools (diagnostic)", False, True),
                 ("B+", "max", "selector", "extended selector (B+)", True, False), ("C+", "max", "agent", "extended agent (C+), three seeds pooled", True, False),
                 ("O+", "max", "oracle", "pool oracle, all presets (diagnostic)", False, True), ("V", "max", "agent_qwen3max_vote", "extended agent, three-seed vote", False, False)]


def agent():
    """V13 · 8 configurations × 2 folds (n = 16) from agent_w05.csv (base) and agent_max_w05.csv (extended); meta.pairs from the pair tables."""
    src = {"base": csv("agent_w05.csv"), "max": csv("agent_max_w05.csv")}
    rows = []
    for order, (config, which, row, label, has_cost, diag) in enumerate(AGENT_CONFIGS):
        for fold in FOLDS:
            r = one(src[which], row=row, fold=fold)
            rows.append(dict(config=config, label=label, order=order, fold=fold, n=int(r.n), n_drivers=int(r.n_drivers), route_pct=num(r.route_pct, 1), route_lo=num(r.route_lo, 1),
                             route_hi=num(r.route_hi, 1), ade_median=num(r.ade_median, 1), ade_lo=num(r.ade_lo, 1), ade_hi=num(r.ade_hi, 1), fde500_pct=num(r.fde500_pct, 1),
                             cost_s=num(r.cost_reconstructed_med, 1) if has_cost else None, n_seeds=int(r.n_seeds), diagnostic=diag))
            assert not has_cost or rows[-1]["cost_s"] is not None, config
    assert len(rows) == 16
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    assert set(cols["n"]) == {268, 391}
    spot(cols, dict(config="A", fold="test"), route_pct=69.4, route_lo=57.7, route_hi=85.0, cost_s=0.3)
    spot(cols, dict(config="B", fold="test"), route_pct=75.0, route_lo=66.6, route_hi=87.0, cost_s=1.1)
    spot(cols, dict(config="C", fold="test"), route_pct=75.1, route_lo=66.0, route_hi=87.6, cost_s=36.4)
    spot(cols, dict(config="B+", fold="test"), route_pct=73.9, route_lo=66.1, route_hi=85.1, cost_s=4.8)
    spot(cols, dict(config="C+", fold="test"), route_pct=78.0, route_lo=70.7, route_hi=88.5, cost_s=102.4)
    spot(cols, dict(config="O3", fold="test"), route_pct=82.8, cost_s=None, diagnostic=True)
    spot(cols, dict(config="O+", fold="test"), route_pct=87.3, cost_s=None, diagnostic=True)
    spot(cols, dict(config="V", fold="test"), route_pct=78.7, cost_s=None, diagnostic=False)
    pt, pm = csv("agent_pairs_w05.csv"), csv("agent_max_pairs_w05.csv")

    def pair(df, name, fold, label):
        r = one(df, pair=name, fold=fold)
        return {"pair": label, "fold": fold, "n": int(r.n), "diff_pp": num(r.route_diff_pp, 2), "lo_pp": num(r.route_lo_pp, 2), "hi_pp": num(r.route_hi_pp, 2)}
    pairs = [pair(pt, "agent_vs_selector", "test", "C − B"), pair(pt, "agent_vs_selector", "few_shot_heldout", "C − B"), pair(pm, "agent_vs_selector", "test", "C+ − B+"),
             pair(pm, "agent_vs_selector", "few_shot_heldout", "C+ − B+"), pair(pm, "agent_vs_prev", "all", "C+ − C")]
    assert [(p["diff_pp"], p["lo_pp"], p["hi_pp"]) for p in pairs] == [(0.12, -1.65, 3.36), (0.68, -2.58, 2.79), (4.1, 1.3, 7.63), (-0.68, -2.77, 1.58), (-0.4, -2.78, 2.03)], pairs
    assert [p["n"] for p in pairs] == [268, 391, 268, 391, 659]
    meta = {"source": "agent_w05.csv, agent_max_w05.csv, agent_pairs_w05.csv, agent_max_pairs_w05.csv",
            "units": {"route_pct": "%", "route_lo": "%", "route_hi": "%", "ade_median": "m", "ade_lo": "m", "ade_hi": "m", "fde500_pct": "%", "cost_s": "s"},
            "axes": {"x": "route recovered (%)", "y": "configuration (order)"},
            "series": [],
            "notes": ["one five-minute window per evaluation drive (268 test windows of 42 drivers; 391 few-shot windows of 50 drivers); 95 % driver-clustered intervals",
                      "C and C+: Qwen3-14B tool-calling agent, three seeds pooled; B+ / C+ / O+ / V: the extended configuration (ten reconstructor presets, comparison and scoring tools, twelve turns)",
                      "cost_s: reconstructed serial median cost per window in seconds (null for the oracles and the three-seed vote); fde500_pct: share of windows ending more than 500 m off",
                      "diagnostic = pool oracle (a diagnostic, not a deployable selector); pairs: route differences in percentage points with 95 % intervals (C+ − C pooled over both folds)",
                      "single-series chart (--ct-mono); oracles drawn as hollow diamonds"],
            "pairs": pairs, "x_domain": [50, 100], "live_ratio": 1.1}
    return table("agent", "Candidate selection on one five-minute window per evaluation drive: route recovery with 95 % driver-clustered intervals and the reconstructed serial cost per window for the beam, the supervised selector, the LLM agent and the diagnostic oracles.", cols, meta)


DENSITY_STEMS = ["map_pf_steer__G3", "map_beam_steer__G3", "map_pf_none__G1", "dr_steer__G3"]
DENSITY_LEVELS = [("low (< 56/km2)", "sparse", "< 56 nodes/km²"), ("mid (56 to 246/km2)", "mid", "56–246"), ("high (> 246/km2)", "dense", "> 246")]


def density():
    """V14 · 4 methods × 3 density tertiles × 2 windows (n = 24) from T7b_density_strata_v11.csv (pooled folds); common failure by density in meta."""
    d = csv("T7b_density_strata_v11.csv"); d = d[d.fold == "main"]
    rows = []
    for stem in DENSITY_STEMS:
        for win in ("w05", "w15"):
            for order, (lv, level, lab) in enumerate(DENSITY_LEVELS):
                r = one(d, method=stem, win=win, level=lv)
                rows.append(dict(stem=stem, protocol=str(r.protocol), win=win, level=level, level_label=lab, level_order=order, n_episodes=int(r.n_episodes), n_drivers=int(r.n_drivers),
                                 n_platforms=int(r.n_platforms), ade_median=num(r.ade_median, 1), lo=num(r.ade_median_lo, 1), hi=num(r.ade_median_hi, 1), c100=num(r.c100, 3), lost_road=num(r.lost_road, 3)))
    assert len(rows) == 24
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    cols.update(ident_cols(cols["stem"], ("key", "label", "slot", "style")))
    spot(cols, dict(stem="map_pf_none__G1", win="w05", level="sparse"), ade_median=72.8)
    spot(cols, dict(stem="map_pf_none__G1", win="w05", level="mid"), ade_median=676.6)
    spot(cols, dict(stem="map_pf_none__G1", win="w05", level="dense"), ade_median=842.6)   # source 842.646 m (SPEC §3.3 prints 842.7; the paper caption rounds to 843 m)
    spot(cols, dict(stem="map_pf_steer__G3", win="w05", level="sparse"), lost_road=0.17)
    spot(cols, dict(stem="map_pf_steer__G3", win="w05", level="dense"), lost_road=0.271)
    cf = csv("common_failure_strata_w05.csv"); cf = cf[cf.stratum == "density"]
    lvl = {"low": "sparse", "mid": "mid", "high": "dense"}
    common = [{"level": lvl[str(r.level).split(" ")[0]], "n": int(r.n), "share": num(r.all_fail_share, 4), "lo": num(r.all_fail_lo, 4), "hi": num(r.all_fail_hi, 4)} for r in cf.itertuples()]
    assert [z["level"] for z in common] == ["sparse", "mid", "dense"] and [z["share"] for z in common] == [0.0093, 0.0193, 0.0294], common
    meta = {"source": "T7b_density_strata_v11.csv, common_failure_strata_w05.csv",
            "units": {"ade_median": "m", "lo": "m", "hi": "m", "c100": "share", "lost_road": "share"},
            "axes": {"x": "road density around the start (tertiles: < 56, 56–246, > 246 nodes per km²)", "y": "median ADE (m, log scale)"},
            "series": series_meta(cols["stem"]),
            "notes": ["test and few-shot pooled; tertile cuts at 56 and 246 nodes per km² (cuts); 1,292 five-minute windows per tertile",
                      "lo / hi: 95 % driver-bootstrap interval of the median; c100: share of seconds within 100 m; lost_road: share of windows whose path leaves the reference road",
                      "common_failure: share of five-minute windows that no map method recovers, by density tertile, with 95 % intervals",
                      "density is confounded with region, driver, speed and fold: associations, not effects; class F reference rows are excluded"],
            "cuts": [56, 246], "common_failure": common, "y_domain": [10, 20000], "wins": {"w05": "5 min", "w15": "15 min"}}
    return table("density", "Median five- and fifteen-minute ADE by road density around the start (tertiles at 56 and 246 nodes per km²), test and few-shot pooled.", cols, meta)


CONF_SERIES = [("map_beam_steer__G3", "F-M-Hp"), ("map_beam_none__G1", "F-M-Hp"), ("map_beam_steer__G3", "F-M-Hm"), ("map_beam_none__G1", "F-M-Hm")]


def confidence():
    """V16 · 4 series × 8 thresholds × 2 folds (n = 64) from confidence_w05_w15.csv (w05); the eight summary rows in meta (route_overall from the board)."""
    c = csv("confidence_w05_w15.csv"); c = c[c.win == "w05"]
    th, su = c[c.kind == "threshold"], c[c.kind == "summary"]
    board_t = csv("main_board.csv")
    rows, summary = [], []
    for stem, proto in CONF_SERIES:
        for fold in FOLDS:
            t = th[(th.stem == stem) & (th.protocol == proto) & (th.fold == fold)].sort_values("tau")
            assert len(t) == 8 and [round(x, 1) for x in t.tau] == [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], (stem, proto, fold, len(t))
            for r in t.itertuples():
                rows.append(dict(stem=stem, protocol=proto, heading="known" if proto.endswith("Hp") else "unknown", fold=fold, tau=num(r.tau, 1), n_accepted=int(r.n_accepted),
                                 coverage=num(r.coverage, 3), route_rate_accepted=num(r.route_rate_accepted, 3), route_lo=num(r.route_rate_lo, 3), route_hi=num(r.route_rate_hi, 3),
                                 error_share_accepted=num(r.error_share_accepted, 3), median_ade_accepted=num(r.median_ade_accepted, 1)))
            s = one(su, stem=stem, protocol=proto, fold=fold); b = one(board_t, stem=stem, protocol=proto, win="w05", fold=fold)
            summary.append({"stem": stem, "protocol": proto, "fold": fold, "auroc": num(s.auroc, 3), "auroc_lo": num(s.auroc_lo, 3), "auroc_hi": num(s.auroc_hi, 3),
                            "spearman_ade": num(s.spearman_ade, 3), "share_prob_eq_1": num(s.share_prob_eq_1, 3), "route_overall": num(b.route_ok, 3)})
    assert len(rows) == 64 and len(summary) == 8
    cols = {k: [r[k] for r in rows] for k in rows[0]}
    cols.update(ident_cols(cols["stem"], ("key", "label", "slot", "style")))
    spot(cols, dict(stem="map_beam_steer__G3", protocol="F-M-Hp", fold="test", tau=0.9), coverage=0.456, route_rate_accepted=0.872, error_share_accepted=0.128)
    spot(cols, dict(stem="map_beam_none__G1", protocol="F-M-Hp", fold="test", tau=0.9), coverage=0.129, route_rate_accepted=0.972)
    s0 = [z for z in summary if z["stem"] == "map_beam_steer__G3" and z["protocol"] == "F-M-Hp" and z["fold"] == "test"][0]
    assert (s0["auroc"], s0["auroc_lo"], s0["auroc_hi"], s0["route_overall"]) == (0.474, 0.412, 0.517, 0.876), s0
    assert [z["route_overall"] for z in summary if z["fold"] == "test"] == [0.876, 0.537, 0.812, 0.324]
    assert [z["auroc"] for z in summary if z["fold"] == "test" and z["stem"] == "map_beam_none__G1" and z["protocol"] == "F-M-Hp"] == [0.814]
    meta = {"source": "confidence_w05_w15.csv, main_board.csv (route_overall)",
            "units": {"coverage": "share", "route_rate_accepted": "share", "route_lo": "share", "route_hi": "share", "error_share_accepted": "share", "median_ade_accepted": "m"},
            "axes": {"x": "share of windows accepted (coverage)", "y": "route rate among the accepted windows"},
            "series": series_meta([s for s, _ in CONF_SERIES]),
            "notes": ["accept only windows whose top candidate's normalised score exceeds tau (0.3 … 1.0, left to right = decreasing coverage); five-minute windows",
                      "route_lo / route_hi: 95 % driver-clustered interval of the route rate among the accepted; error_share_accepted = 1 − route_rate_accepted",
                      "summary: AUROC of the score for recovered against unrecovered routes with its interval, Spearman correlation with ADE, share of windows scoring exactly 1, and the overall route rate (route_overall, all windows)",
                      "a confidence score, not a calibrated probability"],
            "summary": summary, "x_domain": [0, 1], "y_domain": [0.4, 1], "taus": [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], "label_taus": [0.5, 0.9, 1.0]}
    return table("confidence", "Share of five-minute windows accepted against the route rate among the accepted when only windows whose top candidate's normalised score exceeds a threshold are kept, per fold.", cols, meta)


BUILDERS = {"board": board, "cdf": cdf, "horizon": horizon, "robust": robust, "topk": topk, "taxonomy": taxonomy, "gains": gains, "cost": cost, "agent": agent,
            "density": density, "confidence": confidence}
EXPECTED_N = {"board": 188, "cdf": 30, "horizon": 78, "robust": 60, "topk": 16, "taxonomy": 16, "gains": 28, "cost": 20, "agent": 16, "density": 24, "confidence": 64}


def export_all(put, only=None, skip_cdf=False):
    """Build the eleven table/1 objects in §3.13 order and hand each to put(key, filename, obj, first_view=False) after the gate.
    only: iterable of keys to restrict to; skip_cdf: leave the per-episode curve file out (the one that reads the 128 MB score table)."""
    written = []
    skip_cdf = skip_cdf or os.environ.get("CANTRAJ_SKIP_CDF") == "1"      # the orchestrator sets this for --skip-cdf as well
    for key in KEYS:
        if (only and key not in set(only)) or (skip_cdf and key == "cdf"): continue
        obj = BUILDERS[key]()
        assert obj["n"] == EXPECTED_N[key], f"{key}: n = {obj['n']} ≠ {EXPECTED_N[key]}"
        text = gate(key, obj)
        put(key, key + ".json", obj, first_view=False)
        written.append((key, len(text.encode("utf8"))))
    return written


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="CANTraj chart data (table/1) · standalone runner; writes to WORK/_scratch/wpa2/data/ unless --out is given")
    ap.add_argument("--out", default=os.path.join(WORK, "_scratch", "wpa2", "data")); ap.add_argument("--only", default=None, help="comma-separated keys")
    ap.add_argument("--skip-cdf", action="store_true"); A = ap.parse_args()
    os.makedirs(A.out, exist_ok=True); files = {}

    def put(key, name, obj, first_view=False):
        p = os.path.join(A.out, name); n, h = write_json(p, obj)
        txt = open(p, encoding="utf8").read(); hit = FORBID.search(txt)
        assert not hit, f"{name}: forbidden string {hit.group(0)!r} after write"
        files[key] = {"path": "static/data/" + name, "sha256": h, "bytes": n, "first_view": first_view}
        print(f"  data  {name:18s} {n/1024:7.1f} KB  n={obj['n']}")
    written = export_all(put, only=A.only.split(",") if A.only else None, skip_cdf=A.skip_cdf)
    print(f"{len(written)} files, {sum(b for _, b in written)/1024:.1f} KB total -> {A.out}")
