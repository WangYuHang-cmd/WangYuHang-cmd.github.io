#!/usr/bin/env python3
"""check_sources.py <page>… | --file sources.json
For every arXiv source: fetch the paper body (arxiv.org/html/<id>v<N>, falling back to the abs page) and require the
verbatim `quote` to occur (whitespace-normalised, ≤ 120 chars); report when a newer version than the cited one exists.
HF-card sources: fetch the README via the public API and require the quote. Log sources are skipped."""
import argparse, json, os, re, sys, urllib.request, html
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
UA = {"User-Agent": "Mozilla/5.0 check_sources"}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=40) as r: return r.read().decode("utf8", "replace")
def norm(s): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).replace("−", "-").replace("–", "-").replace("—", "-").strip().lower()
_cache = {}
def arxiv_text(aid):
    if aid in _cache: return _cache[aid]
    txt = ""
    for u in (f"https://arxiv.org/html/{aid}", f"https://arxiv.org/abs/{aid}"):
        try: txt = norm(get(u)); break
        except Exception as e: err = e
    _cache[aid] = txt; return txt
def latest_version(base_id):
    try: page = get(f"https://arxiv.org/abs/{base_id}")
    except Exception: return None
    vs = re.findall(r"\[v(\d+)\]", page); return max(map(int, vs)) if vs else None
def check(sources_path):
    P = []; S = json.load(open(sources_path))
    for s in S.get("sources", []):
        q = norm(s.get("quote") or "")
        if s["kind"] == "arxiv":
            m = re.search(r"abs/(\d{4}\.\d{5})(v\d+)?", s.get("url") or "")
            if not m: P.append(f"{s['id']}: no arXiv id in url"); continue
            base, ver = m.group(1), m.group(2) or (s.get("version") or "")
            aid = base + (ver if ver else "")
            txt = arxiv_text(aid)
            if not txt: P.append(f"{s['id']}: could not fetch {aid}"); continue
            if q and q.replace("-", "") not in txt.replace("-", ""): P.append(f"{s['id']}: quote not found in {aid}: “{s['quote']}”")
            lv = latest_version(base); cv = int(ver[1:]) if ver else None
            if lv and cv and lv > cv: P.append(f"{s['id']}: cites v{cv} but v{lv} exists")
        elif s["kind"] in ("hf-card", "hf-api"):
            m = re.search(r"huggingface\.co/(datasets/)?([\w.-]+/[\w.-]+)", s.get("url") or "")
            if not m: P.append(f"{s['id']}: no HF repo in url"); continue
            repo = m.group(2); kind = "datasets" if m.group(1) or "/models/" not in s["url"] else "models"
            txt = ""
            for u in (f"https://huggingface.co/{repo}", f"https://huggingface.co/datasets/{repo}"):  # rendered card page is public even when files are gated
                try: txt = norm(get(u)); break
                except Exception: continue
            if not txt: P.append(f"{s['id']}: could not fetch README for {repo}"); continue
            if q and q not in txt: P.append(f"{s['id']}: quote not found in {repo} README: “{s['quote']}”")
    return P
if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("pages", nargs="*"); ap.add_argument("--file", nargs="*"); a = ap.parse_args(); bad = False
    files = list(a.file or []) + [os.path.join(ROOT, p, "static", "data", "sources.json") for p in a.pages]
    for f in files:
        if not os.path.exists(f): print(f"== {f}: missing"); bad = True; continue
        pr = check(f); print(f"== {os.path.relpath(f, ROOT)}: {'ok' if not pr else str(len(pr)) + ' problem(s)'}"); [print("   -", x) for x in pr]; bad |= bool(pr)
    sys.exit(1 if bad else 0)
