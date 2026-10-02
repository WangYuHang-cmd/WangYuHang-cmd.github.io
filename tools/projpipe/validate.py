#!/usr/bin/env python3
"""projpipe · validator (contracts + privacy gate + budgets).

  validate.py --fixtures                 check every JSON under assets/proj/fixtures/data/
  validate.py --page tridrive            check <page>/static/data/* + manifest items, media, page HTML, budgets, stale assets
  validate.py --file path.json [...]     check individual files (schema inferred from "schema")
Exit code 1 on any failure. Mirrors Proj.assertShape() in assets/proj/proj.js — keep the two in sync."""
import argparse, base64, glob, json, math, os, re, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from common import CAPS, PATHS, scan_forbidden, denied, ffprobe

def b64n(s, dtype): return len(base64.b64decode(s)) // np.dtype(dtype).itemsize
def is_num(v): return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)

def check_shape(o, kind=None):
    """→ list of problems (empty = ok)."""
    P = []
    sch = str(o.get("schema", ""))
    kind = kind or sch.split("/")[0]
    if not sch.startswith(kind + "/1"): P.append(f'schema "{sch}" is not {kind}/1'); return P
    def arr(a, n, name):
        if not isinstance(a, list): P.append(f"{name} missing/not a list"); return False
        if n is not None and len(a) != n: P.append(f"{name} length {len(a)} ≠ {n}"); return False
        return True
    def no_nan(a, name):
        for i, v in enumerate(a):
            if isinstance(v, float) and not math.isfinite(v): P.append(f"{name}[{i}] is NaN/inf"); return
    if kind == "signals":
        n, hz = o.get("n"), o.get("hz")
        if not is_num(n) or n < 2: P.append("n")
        if not is_num(hz) or hz <= 0: P.append("hz")
        cols = o.get("cols") or {}
        if "t" not in cols: P.append("cols.t missing")
        for k, a in cols.items():
            if arr(a, n, f"cols.{k}"): no_nan(a, f"cols.{k}")
        t = cols.get("t") or []
        for i in range(1, len(t)):
            if not (t[i] > t[i - 1]): P.append(f"t not increasing at {i}"); break
            if abs(t[i] - t[i - 1] - 1 / hz) > 1e-3 + 0.01 / hz: P.append(f"t step ≠ 1/hz at {i}"); break
        if t:
            for i, e in enumerate(o.get("events") or []):
                if not is_num(e.get("t")) or e["t"] < t[0] - 1e-6 or e["t"] > t[-1] + 1 / hz + 1e-6: P.append(f"events[{i}].t outside clip")
        for i, s in enumerate(o.get("series") or []):
            if arr(s.get("t"), None, f"series[{i}].t"): arr(s.get("v"), len(s["t"]), f"series[{i}].v")
        for i, b in enumerate(o.get("bands") or []):
            if arr(b.get("t"), None, f"bands[{i}].t"):
                for q, a in (b.get("q") or {}).items(): arr(a, len(b["t"]), f"bands[{i}].q.{q}")
        for i, f in enumerate(o.get("fans") or []):
            if not all(is_num(f.get(k)) for k in ("anchor_t", "step_s", "horizon_s")): P.append(f"fans[{i}] anchor/step/horizon")
            else: arr(f.get("p"), round(f["horizon_s"] / f["step_s"]), f"fans[{i}].p")
    elif kind == "timeline":
        sp = o.get("span")
        if not (isinstance(sp, list) and len(sp) == 2 and sp[0] < sp[1]): P.append("span"); return P
        for i, l in enumerate(o.get("lanes") or []):
            for s in l.get("segs") or []:
                if not (s[0] <= s[1]) or s[0] < sp[0] - 1e-6 or s[1] > sp[1] + 1e-6: P.append(f"lanes[{i}] seg {s[:2]} outside span")
            for m in l.get("marks") or []:
                if not is_num(m.get("t")) or m["t"] < sp[0] or m["t"] > sp[1]: P.append(f"lanes[{i}] mark outside span")
    elif kind == "embedding":
        n = o.get("n")
        if not is_num(n) or n < 1: P.append("n"); return P
        if not (isinstance(o.get("bbox"), list) and len(o["bbox"]) == 4): P.append("bbox")
        if b64n(o["xy_i16"], "<i2") != 2 * n: P.append("xy_i16 length ≠ 2n")
        for k, d in (o.get("dims") or {}).items():
            idx = np.frombuffer(base64.b64decode(d["idx"]), dtype="<u2")
            if len(idx) != n: P.append(f"dims.{k}.idx length ≠ n")
            elif idx.max(initial=0) >= len(d["names"]): P.append(f"dims.{k} idx ≥ names")
        for r in o.get("reps") or []:
            if r.get("dim") not in (o.get("dims") or {}) or not (0 <= r.get("i", -1) < n): P.append(f"rep {r.get('name')} invalid")
    elif kind == "kpts":
        n, K = o.get("n"), o.get("K", 133)
        if not is_num(n) or n < 1: P.append("n"); return P
        if b64n(o["kpts"], "<i2") != n * K * 2: P.append("kpts length")
        if b64n(o["score"], "u1") != n * K: P.append("score length")
        if not (is_num(o.get("aspect")) and o["aspect"] > 0): P.append("aspect")
        c = o.get("crop")
        if not (isinstance(c, list) and len(c) == 4 and c[0] < c[2] and c[1] < c[3]): P.append("crop")
        for k, a in (o.get("can") or {}).items(): arr(a, n, f"can.{k}")
        if o.get("head"):
            for k in ("yaw", "pitch", "roll"): arr(o["head"].get(k), n, f"head.{k}")
        pv = o.get("part_valid")
        if pv and b64n(pv["v"], "u1") != n * len(pv["names"]): P.append("part_valid length")
    elif kind == "paired":
        ax = o.get("axis") or {}
        if not (is_num(ax.get("min")) and is_num(ax.get("max"))): P.append("axis")
        for i, g in enumerate(o.get("groups") or []): arr(g.get("rows"), None, f"groups[{i}].rows")
    elif kind == "bars": arr(o.get("rows"), None, "rows")
    elif kind == "hist":
        if not is_num(o.get("bin_w")): P.append("bin_w")
        for i, g in enumerate(o.get("groups") or []): arr(g.get("counts"), None, f"groups[{i}].counts")
    elif kind == "sources":
        for s in o.get("sources") or []:
            if s.get("kind") == "unpublished": P.append(f"source {s.get('id')} is unpublished")
            if s.get("kind") not in ("arxiv", "hf-card", "hf-api", "log", "github"): P.append(f"source {s.get('id')} kind {s.get('kind')}")
            if s.get("quote") and len(s["quote"]) > 120: P.append(f"source {s.get('id')} quote > 120 chars")
    elif kind == "manifest":
        for k, f in (o.get("files") or {}).items():
            if not re.fullmatch(r"[0-9a-f]{64}", str(f.get("sha256", ""))): P.append(f"files.{k}.sha256")
        for it in o.get("items") or []:
            pr = it.get("privacy") or {}
            if pr.get("manual_review") != "ok": P.append(f"item {it.get('id')} manual_review={pr.get('manual_review')}")
            if pr.get("kind") == "skeleton" and pr.get("source_pixels") is not False: P.append(f"item {it.get('id')} skeleton must have source_pixels:false")
            if pr.get("kind") == "cabin_allowlisted" and pr.get("allowlisted") is not True: P.append(f"item {it.get('id')} cabin not allow-listed")
    elif kind == "clips":
        for i, c in enumerate(o.get("clips") or []):
            if not c.get("id") or not (c.get("src") or c.get("signals")): P.append(f"clips[{i}] needs id and src")
    elif kind == "bands":
        for i, b in enumerate(o.get("bands") or []):
            if arr(b.get("t"), None, f"bands[{i}].t"):
                for q, a in (b.get("q") or {}).items(): arr(a, len(b["t"]), f"bands[{i}].q.{q}")
    elif kind in ("hf_meta", "numbers", "composition"): pass
    else: P.append(f"unknown kind {kind}")
    return P

def check_file(path, kind=None):
    P = []
    if denied(path): return [f"DENY_FILES match: {os.path.basename(path)}"]
    raw = open(path, encoding="utf8").read()
    if len(raw.encode()) > CAPS["json_bytes"] and not path.endswith("manifest.json"): P.append(f"{len(raw)//1024} KB > json cap")
    hits = scan_forbidden(raw)
    if hits: P.append(f"FORBIDDEN {hits[:4]}")
    try: o = json.loads(raw)
    except Exception as e: return P + [f"invalid JSON: {e}"]
    return P + check_shape(o, kind)

def check_media(path):
    P = []
    try: m = ffprobe(path)
    except Exception as e: return [f"ffprobe failed: {e}"]
    if m["codec"] != "h264": P.append(f"codec {m['codec']}")
    if m["pix_fmt"] != "yuv420p": P.append(f"pix_fmt {m['pix_fmt']}")
    if m["width"] % 2 or m["height"] % 2: P.append("odd dimensions")
    if m["bytes"] > CAPS["video_bytes"]: P.append(f"{m['bytes']//1024} KB > video cap")
    head = open(path, "rb").read(64 << 10)
    if head.find(b"moov") < 0: P.append("moov atom not at the front (faststart)")
    return P

def check_page(page):
    repo = PATHS["repo"]; root = os.path.join(repo, page); P = {}
    data_dir = os.path.join(root, "static", "data"); media_dir = os.path.join(root, "static", "media")
    for p in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        pr = check_file(p)
        if pr: P[os.path.relpath(p, repo)] = pr
    for p in sorted(glob.glob(os.path.join(media_dir, "*.mp4"))):
        pr = check_media(p)
        if pr: P[os.path.relpath(p, repo)] = pr
    for p in sorted(glob.glob(os.path.join(media_dir, "*.jpg"))):
        sz = os.path.getsize(p); cap = CAPS["poster_bytes"] if "poster" in p or "lqip" in p else CAPS["figure_bytes"]
        if sz > cap: P[os.path.relpath(p, repo)] = [f"{sz//1024} KB > cap {cap//1024} KB"]
    html = os.path.join(root, "index.html")
    if os.path.exists(html):
        hits = scan_forbidden(open(html, encoding="utf8").read())
        if hits: P[os.path.relpath(html, repo)] = [f"FORBIDDEN {hits[:4]}"]
    man = os.path.join(data_dir, "manifest.json")
    if os.path.exists(man):
        m = json.load(open(man))
        for k, f in (m.get("files") or {}).items():
            fp = os.path.join(root, f["path"]) if not f["path"].startswith("static/") else os.path.join(root, f["path"])
            if not os.path.exists(fp): P.setdefault("manifest", []).append(f"files.{k} → {f['path']} missing")
        total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(media_dir, "*")))
        if total > CAPS["total_media_bytes"]: P.setdefault("budget", []).append(f"media {total/1e6:.1f} MB > {CAPS['total_media_bytes']/1e6:.0f} MB")
        # stale assets: tracked files under static/ that no manifest item or file references (favicon exempt)
        try:
            tracked = subprocess.run(["git", "ls-files", os.path.join(page, "static")], capture_output=True, text=True, cwd=repo).stdout.split()
            refd = set(f["path"] for f in (m.get("files") or {}).values())
            for it in m.get("items") or []: refd |= set((it.get("files") or {}).values())
            html_txt = open(html, encoding="utf8").read() if os.path.exists(html) else ""
            for tpath in tracked:
                rel = os.path.relpath(tpath, page)
                if rel.endswith("favicon.ico") or rel.endswith("manifest.json") or rel.endswith("SHA256SUMS"): continue
                if rel not in refd and os.path.basename(rel) not in html_txt: P.setdefault("stale", []).append(rel)
        except Exception as e: P.setdefault("stale", []).append(f"git ls-files failed: {e}")
    return P

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--fixtures", action="store_true"); ap.add_argument("--page"); ap.add_argument("--file", nargs="*")
    a = ap.parse_args(); problems = {}
    if a.fixtures:
        for p in sorted(glob.glob(os.path.join(PATHS["repo"], "assets", "proj", "fixtures", "data", "*.json"))):
            pr = check_file(p)
            if pr: problems[os.path.basename(p)] = pr
            else: print(f"ok   {os.path.basename(p)}")
    for p in a.file or []:
        pr = check_file(p)
        if pr: problems[p] = pr
        else: print(f"ok   {p}")
    if a.page: problems.update(check_page(a.page))
    if problems:
        for k, v in problems.items(): print(f"FAIL {k}:"); [print(f"       - {x}") for x in v]
        sys.exit(1)
    print("all checks passed")

if __name__ == "__main__": main()
