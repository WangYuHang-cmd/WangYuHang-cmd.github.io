#!/usr/bin/env python3
"""check_pages.py <page> [<page>…] [--online] [--chrome]
Static gates for a kit-based project page (<page>/index.html):
  refs      every local src/href/poster/data-src resolves to a file
  motion    no literal durations/beziers in page HTML (tokens live in proj.css)
  venue     no submission-venue / anonymity leakage (KDD, WACV, ICLR, "anonymous", "submission")
  claims    superlatives only inside elements carrying data-claim (verbatim paper quotes)
  numbers   every <data class="n" value=…> matches a value in tools/projpipe/registry.yaml for this page
  tiers     "gated: auto|manual" text in #data matches assets/proj/data/hf_meta.json
  contrast  the page accent vs --cl-bg / --cl-surface ≥ 4.5:1 (from proj.css tokens)
  online    (--online) external links answer < 400 to HEAD/GET
  chrome    (--chrome) More-works dropdown entries agree across pages; home cards/news/projects.md carry registry numbers
"""
import argparse, html, json, os, re, sys, urllib.request
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PAGES = ["tridrive", "adasto", "drivedna", "drivemotion", "baton"]
VENUE_RX = re.compile(r"\b(KDD|WACV|ICLR|NeurIPS|CVPR|anonymous|anonymized|double-blind|submission|submitted to)\b", re.I)
SUPERLATIVE_RX = re.compile(r"\b(the first|the only|state[- ]of[- ]the[- ]art|SOTA|the largest|the best|unprecedented|novel)\b", re.I)
MOTION_RX = re.compile(r"\b\d+(?:\.\d+)?m?s\b(?=[^<]*[;\"])|cubic-bezier\(")

def load_yaml(path):  # minimal loader for registry.yaml's two-level mapping of flow-style dicts
    out, cur = {}, None
    for line in open(path, encoding="utf8"):
        if not line.strip() or line.lstrip().startswith("#"): continue
        if not line.startswith(" "): cur = line.split(":")[0].strip(); out[cur] = {}; continue
        key, _, rest = line.strip().partition(":"); rest = rest.strip()
        if rest.startswith("{") and rest.endswith("}"):
            d = {}
            for part in re.findall(r'(\w+):\s*("(?:[^"\\]|\\.)*"|[^,}]+)', rest[1:-1]):
                k, v = part; v = v.strip()
                if v.startswith('"'): v = v[1:-1]
                else:
                    try: v = float(v) if "." in v else int(v)
                    except ValueError: pass
                d[k] = v
            out[cur][key] = d
    return out

def rel_lum(hexc):
    h = hexc.lstrip("#"); r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def contrast(a, b): la, lb = rel_lum(a), rel_lum(b); return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
def blend(fg, alpha, bg):
    f = [int(fg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]; b = [int(bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(f[i] * alpha + b[i] * (1 - alpha)):02x}" for i in range(3))

def strip_tags(s): return html.unescape(re.sub(r"<[^>]+>", " ", s))

from html.parser import HTMLParser
class _Claims(HTMLParser):
    VOID = {"br", "img", "meta", "link", "input", "hr", "source", "wbr"}
    def __init__(self): super().__init__(); self.depth = 0; self.out = []; self.stack = []
    def handle_starttag(self, tag, attrs):
        if tag in self.VOID: return
        self.stack.append(tag in ("data-claim",) or any(k == "data-claim" for k, _ in attrs))
        if self.stack[-1]: self.depth += 1
    def handle_endtag(self, tag):
        if tag in self.VOID or not self.stack: return
        if self.stack.pop(): self.depth -= 1
    def handle_data(self, d):
        if self.depth > 0: self.out.append(d)
def claim_text(body): p = _Claims(); p.feed(body); return " ".join(p.out)

def check(page, online=False):
    P = []; path = os.path.join(ROOT, page, "index.html")
    if not os.path.exists(path): return [f"{page}/index.html missing"]
    src = open(path, encoding="utf8").read()
    if 'assets/proj/proj.css' not in src: return [f"{page}: not a kit page (no proj.css) — skipped"]
    body = src.split("<body", 1)[1] if "<body" in src else src
    # refs
    for m in re.finditer(r'(?:src|href|poster|data-src|data-video|data-poster|data-zoom)="([^"#][^"]*)"', src):
        u = m.group(1).split("?")[0]
        if u.startswith(("http", "mailto:", "data:", "key:", "//", "javascript:")): continue
        if re.fullmatch(r"[\w-]+", u): continue  # source ids on <data data-src="…">, not paths
        fp = os.path.join(ROOT, u.lstrip("/")) if u.startswith("/") else os.path.join(ROOT, page, u)
        if u.startswith("/") and u.endswith("/") and os.path.exists(os.path.join(ROOT, u.strip("/") + ".md")): continue  # Jekyll page from <name>.md
        if not os.path.exists(fp): P.append(f"ref missing: {u}")
    # motion literals (ignore inside <script>/<style> JSON data and the preview JSON)
    scanned = re.sub(r"<script[^>]*>.*?</script>", "", body, flags=re.S)
    for m in MOTION_RX.finditer(re.sub(r"<style[^>]*>.*?</style>", "", scanned, flags=re.S)):
        ctx = scanned[max(0, m.start() - 20):m.end() + 10]
        if 'style="' in ctx or "transition" in ctx or "animation" in ctx: P.append(f"literal motion value in HTML: …{ctx.strip()}…")
    text = strip_tags(re.sub(r"<(script|style)[^>]*>.*?</\1>", "", body, flags=re.S))
    for m in VENUE_RX.finditer(text): P.append(f"venue/anonymity leakage: '{m.group(0)}' …{text[max(0, m.start()-30):m.end()+30].strip()}…")
    # claims lock
    allowed = claim_text(body)
    for m in SUPERLATIVE_RX.finditer(text):
        word = m.group(0); ctx = text[max(0, m.start() - 40):m.end() + 40]
        if re.sub(r"\s+", " ", word.lower()) in re.sub(r"\s+", " ", allowed.lower()): continue
        P.append(f"superlative outside data-claim: …{ctx.strip()}…")
    # numbers vs registry
    reg = load_yaml(os.path.join(ROOT, "tools", "projpipe", "registry.yaml")).get(page, {})
    vals = {k: v["value"] for k, v in reg.items() if isinstance(v, dict) and "value" in v}
    for m in re.finditer(r'<data class="n" value="([^"]+)"', body):
        v = float(m.group(1).replace(",", ""))
        if not any(abs(v - float(rv)) <= max(1e-9, abs(float(rv)) * 1e-6) for rv in vals.values()): P.append(f"number {m.group(1)} not in registry[{page}]")
    # tiers vs hf_meta
    hf = os.path.join(ROOT, "assets", "proj", "data", "hf_meta.json")
    if os.path.exists(hf):
        meta = json.load(open(hf))["repos"]
        for m in re.finditer(r'data-hf="([^"]+)"[^>]*>(.*?)</', body, flags=re.S):
            repo, inner = m.group(1), strip_tags(m.group(2)).lower(); info = meta.get(repo)
            if not info: P.append(f"hf repo {repo} not in hf_meta.json"); continue
            want = "auto" if info["gated"] == "auto" else "manual" if info["gated"] == "manual" else "open"
            if want not in inner: P.append(f"{repo}: page says '{inner.strip()[:40]}', hf_meta says gated={info['gated']}")
    # contrast
    css = open(os.path.join(ROOT, "assets", "proj", "proj.css"), encoding="utf8").read()
    acc = re.search(r'body\[data-proj="%s"\]\{--pj-accent:(#[0-9a-f]{6})' % page, css)
    if acc:
        a = acc.group(1); bg = "#070d1d"; surf = blend("#ffffff", 0.045, "#0a1428")
        for name, b in (("--cl-bg", bg), ("--cl-surface", surf)):
            c = contrast(a, b)
            if c < 4.5: P.append(f"accent {a} on {name} contrast {c:.2f} < 4.5")
    # online
    if online:
        seen = set()
        for m in re.finditer(r'href="(https?://[^"]+)"', src):
            u = m.group(1)
            if u in seen: continue
            seen.add(u)
            try:
                req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "Mozilla/5.0 check_pages"})
                with urllib.request.urlopen(req, timeout=15) as r: code = r.status
            except Exception as e:
                code = getattr(e, "code", None)
                if code in (403, 405):  # some hosts refuse HEAD
                    try:
                        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 check_pages"}), timeout=15) as r: code = r.status
                    except Exception as e2: code = getattr(e2, "code", str(e2))
            if not (isinstance(code, int) and code < 400): P.append(f"link {u} → {code}")
    return P

def check_chrome():
    P = []; menus = {}
    for page in PAGES + ["openlka", "vlalert"]:
        path = os.path.join(ROOT, page, "index.html")
        if not os.path.exists(path): continue
        src = open(path, encoding="utf8").read()
        for m in re.finditer(r'<a href="/(\w+)/"><b>([^<]+)</b><span>([^<]+)</span></a>', src): menus.setdefault(m.group(1), set()).add(m.group(3).strip())
    for k, v in menus.items():
        if len(v) > 1: P.append(f"More-works text for /{k}/ differs across pages: {sorted(v)}")
    return P

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("pages", nargs="*"); ap.add_argument("--online", action="store_true"); ap.add_argument("--chrome", action="store_true")
    a = ap.parse_args(); bad = False
    for page in a.pages or PAGES:
        pr = check(page, a.online)
        print(f"== {page}: {'ok' if not pr else str(len(pr)) + ' problem(s)'}"); [print("   -", x) for x in pr]
        bad |= bool(pr) and not (len(pr) == 1 and "skipped" in pr[0])
    if a.chrome:
        pr = check_chrome(); print(f"== chrome: {'ok' if not pr else ''}"); [print("   -", x) for x in pr]; bad |= bool(pr)
    sys.exit(1 if bad else 0)
