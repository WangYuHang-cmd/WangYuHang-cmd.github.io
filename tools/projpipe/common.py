#!/usr/bin/env python3
"""projpipe · shared helpers for the project-page exports (TriDrive · ADAS-TO · DriveDNA · DriveMotion · BATON).

Contracts: assets/proj/CONTRACTS.md. Local Python has numpy + pyarrow but no working pandas; everything here is
numpy/stdlib. Server-side steps (pandas) live in the per-page export scripts and run in the openpilot venv.

Privacy gate: every output passes through write_json()/scan_forbidden(); any match of FORBIDDEN raises.
Inputs may contain device ids, route ids, paths; outputs may not."""
import base64, hashlib, json, math, os, re, subprocess, fnmatch
import numpy as np

PIPELINE_VERSION = "1"
PATHS = {  # overridable with PROJPIPE_* env vars
    "drive": os.environ.get("PROJPIPE_DRIVE", os.path.expanduser("~/Desktop/Drive")),
    "repo": os.environ.get("PROJPIPE_REPO", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))),
    "work": os.environ.get("PROJPIPE_WORK", os.path.expanduser("~/Desktop/Drive/web_showcase_proj")),
    "hf_token_file": os.environ.get("PROJPIPE_HF_TOKEN_FILE", os.path.expanduser("~/Desktop/Drive/AAAI/ICLR/hf_token.txt")),
}
CAPS = {"video_bytes": 2_000_000, "figure_bytes": 350_000, "poster_bytes": 60_000, "lqip_bytes": 500, "json_bytes": 400_000,
        "first_view_bytes": 3_000_000, "total_media_bytes": 25_000_000}
CABIN_ALLOW = ["530075d26cad58e4"]  # compared at export; never written
FORBIDDEN = [
    ("dongle id", re.compile(r"(?<![0-9a-f.])[0-9a-f]{16}(?![0-9a-f])")),  # not after a decimal point (floats)
    ("route id", re.compile(r"[0-9a-f]{8}--[0-9a-f]{10}")),
    ("route timestamp", re.compile(r"\d{4}-\d{2}-\d{2}--\d{2}-\d{2}-\d{2}")),
    ("uid", re.compile(r"[A-Z0-9_]+__[0-9a-f]{16}__")),
    ("session id", re.compile(r"\d{8}T\d{6}Z_[0-9a-f]{16}")),
    ("youtube id", re.compile(r"(?:[?&]v=|youtu\.be/)[\w-]{11}")),
    ("bilibili id", re.compile(r"\bBV[0-9A-Za-z]{10}\b")),
    ("gps key", re.compile(r"\"(?:lat|lon|latitude|longitude|gps_lat|gps_lon)\"\s*:")),
    ("local path", re.compile(r"/home/henry|/data/datasets|Dropbox")),
    ("hf token", re.compile(r"hf_[A-Za-z0-9]{20,}")),
    ("openai key", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}")),
    ("mapbox token", re.compile(r"pk\.[A-Za-z0-9]{20,}\.[A-Za-z0-9]{10,}")),
]
# sha256 digests are 64 hex chars and would trip the 16-hex dongle rule; they are allowed only in manifest sha256 fields (see scan_forbidden)
DENY_FILES = ["*token*", "*id_map*.json", "*hash_map*", "*salt*", "*questionnaire*", "dcamera.mp4", "client_secret_*.json", "JWT.txt", "*.key", "*.pem", "*api_key*"]


# ---------------------------------------------------------------- numbers / json / hashing
def num(v, dp=3):
    """float → rounded float; None/NaN/inf → None (contracts forbid NaN)."""
    if v is None: return None
    try: f = float(v)
    except (TypeError, ValueError): return None
    if not math.isfinite(f): return None
    r = round(f, dp)
    return int(r) if dp == 0 else r

def nums(a, dp=3): return [num(v, dp) for v in a]

def scan_forbidden(text, allow_sha256=True):
    """→ [(rule, match), …]. Manifest sha256 values (64 hex) are masked first when allow_sha256."""
    if allow_sha256: text = re.sub(r"\"sha256\"\s*:\s*\"[0-9a-f]{64}\"", '"sha256":"<sha>"', text)
    text = re.sub(r"\"[A-Za-z0-9+/=]{160,}\"", '"<b64>"', text)  # base64 payloads (kpts/score/xy/idx) are opaque binary, not identifiers
    hits = []
    for name, rx in FORBIDDEN:
        for m in rx.finditer(text): hits.append((name, m.group(0)[:40]))
    return hits

def dumps(obj): return json.dumps(obj, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

def write_json(path, obj):
    s = dumps(obj)
    hits = scan_forbidden(s)
    if hits: raise ValueError(f"FORBIDDEN content in {os.path.basename(path)}: {hits[:5]}")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf8") as f: f.write(s)
    return len(s.encode("utf8")), hashlib.sha256(s.encode("utf8")).hexdigest()

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def denied(path):
    b = os.path.basename(path)
    return any(fnmatch.fnmatch(b, g) for g in DENY_FILES)

def b64_i16(a): return base64.b64encode(np.ascontiguousarray(np.asarray(a, dtype="<i2")).tobytes()).decode("ascii")
def b64_u16(a): return base64.b64encode(np.ascontiguousarray(np.asarray(a, dtype="<u2")).tobytes()).decode("ascii")
def b64_u8(a): return base64.b64encode(np.ascontiguousarray(np.asarray(a, dtype="u1")).tobytes()).decode("ascii")


# ---------------------------------------------------------------- resampling
def resample(t_src, v_src, t_new, kind="linear", tol=None):
    """Resample a (possibly gappy) series onto t_new. kind: linear | nearest (states). Values outside the source span,
    or farther than tol from any source sample (nearest), become None."""
    t_src = np.asarray(t_src, float); v_src = np.asarray(v_src, float); t_new = np.asarray(t_new, float)
    ok = np.isfinite(t_src) & np.isfinite(v_src)
    if ok.sum() < 2: return [None] * len(t_new)
    ts, vs = t_src[ok], v_src[ok]
    order = np.argsort(ts, kind="stable"); ts, vs = ts[order], vs[order]
    if kind == "nearest":
        idx = np.clip(np.searchsorted(ts, t_new), 1, len(ts) - 1)
        left, right = ts[idx - 1], ts[idx]
        pick = np.where(np.abs(t_new - left) <= np.abs(right - t_new), idx - 1, idx)
        out = vs[pick]; dist = np.abs(ts[pick] - t_new)
        tol = tol if tol is not None else np.inf
        out = np.where(dist <= tol, out, np.nan)
    else:
        out = np.interp(t_new, ts, vs, left=np.nan, right=np.nan)
        if tol is not None:  # also blank interpolations that bridge a gap wider than 3·tol
            idx = np.clip(np.searchsorted(ts, t_new), 1, len(ts) - 1); gap = ts[idx] - ts[idx - 1]
            out = np.where(gap > 3 * tol, np.nan, out)
    return [num(x) for x in out]


# ---------------------------------------------------------------- CSV reading (pyarrow; falls back to csv module)
def read_csv(path):
    """→ dict column → np.ndarray (float where possible, else object)."""
    try:
        import pyarrow.csv as pc
        tbl = pc.read_csv(path)
        out = {}
        for name in tbl.column_names:
            col = tbl.column(name).to_numpy(zero_copy_only=False)
            try: out[name] = col.astype(float)
            except (TypeError, ValueError): out[name] = col
        return out
    except ImportError:
        import csv
        rows = list(csv.DictReader(open(path, newline="")))
        out = {}
        for k in rows[0].keys():
            vals = [r[k] for r in rows]
            try: out[k] = np.array([float(v) if v != "" else np.nan for v in vals])
            except ValueError: out[k] = np.array(vals, dtype=object)
        return out

def first_col(d, *names):
    for n in names:
        if n in d: return d[n]
    return None


# ---------------------------------------------------------------- converters → contracts
BATON_COLS = {  # output column → candidate CSV columns (first found wins); file → columns
    "vehicle_dynamics": {"v_ego_mps": ["vEgo", "v_ego", "speed_mps"], "steer_deg": ["steeringAngleDeg", "steering_angle_deg", "steer_deg"],
                         "gas": ["gasPressed", "gas_pressed"], "brake": ["brakePressed", "brake_pressed"], "cc_enabled": ["cc_enabled", "cruiseState_enabled", "ccEnabled"],
                         "cs_active": ["cs_active", "controlsState_active", "csActive"], "blinker_l": ["leftBlinker"], "blinker_r": ["rightBlinker"],
                         "steering_pressed": ["steeringPressed"], "a_ego": ["aEgo"]},
    "driver_state": {"is_distracted": ["isDistracted", "is_distracted"], "awareness": ["awarenessStatus", "awareness_status"], "face_yaw": ["faceOrientation_0", "face_yaw", "faceYaw"],
                     "face_pitch": ["faceOrientation_1", "face_pitch", "facePitch"], "face_prob": ["faceProb", "face_prob"]},
    "radar": {"lead_d_rel": ["leadOne_dRel", "lead_d_rel", "dRel"], "lead_v_rel": ["leadOne_vRel", "lead_v_rel", "vRel"], "lead_status": ["leadOne_status", "lead_status"]},
    "planning": {"lane_change_state": ["laneChangeState", "lane_change_state"]},
}
STATE_COLS = {"gas", "brake", "cc_enabled", "cs_active", "blinker_l", "blinker_r", "steering_pressed", "is_distracted", "awareness", "lead_status", "lane_change_state"}
LABELS = {"v_ego_mps": "speed", "steer_deg": "steering", "gas": "gas", "brake": "brake", "cc_enabled": "automation", "cs_active": "controls active", "is_distracted": "DMS distraction",
          "awareness": "DMS awareness", "face_yaw": "face yaw", "face_pitch": "face pitch", "face_prob": "face prob", "lead_d_rel": "lead distance", "lead_v_rel": "lead rel. speed",
          "lane_change_state": "lane change", "a_ego": "acceleration", "steering_pressed": "driver on wheel"}
UNITS = {"v_ego_mps": "m/s", "steer_deg": "deg", "face_yaw": "rad", "face_pitch": "rad", "lead_d_rel": "m", "lead_v_rel": "m/s", "a_ego": "m/s²"}

def edges(col, rising=True):
    """indices where a 0/1 column (with None) changes state."""
    out = []
    prev = None
    for i, v in enumerate(col):
        if v is None: continue
        b = 1 if v else 0
        if prev is not None and ((rising and prev == 0 and b == 1) or (not rising and prev == 1 and b == 0)): out.append(i)
        prev = b
    return out

def signals_from_baton_csv(route_dir, t_a, t_b, hz=10, clip_id="clip", time_col="time_s", events_from=("cc_enabled", "is_distracted")):
    """BATON-layout route dir (vehicle_dynamics/driver_state/radar/planning.csv on route seconds) → signals/1 for [t_a, t_b]."""
    n = int(round((t_b - t_a) * hz)); t_new = t_a + np.arange(n) / hz
    cols = {"t": [num(x, 2) for x in (t_new - t_a)]}
    for fname, mapping in BATON_COLS.items():
        p = os.path.join(route_dir, fname + ".csv")
        if not os.path.exists(p): continue
        d = read_csv(p); ts = first_col(d, time_col, "t", "time")
        if ts is None: continue
        for out_name, cands in mapping.items():
            src = first_col(d, *cands)
            if src is None or src.dtype == object: continue
            kind = "nearest" if out_name in STATE_COLS else "linear"
            cols[out_name] = resample(ts, src, t_new, kind=kind, tol=1.0 / hz * 1.5)
    present = [k for k in cols if k != "t"]
    events = []
    if "cc_enabled" in cols and "cc_enabled" in events_from:
        for i in edges(cols["cc_enabled"], True): events.append({"t": cols["t"][i], "kind": "engage", "label": "Automation engaged", "glyph": "+"})
        for i in edges(cols["cc_enabled"], False): events.append({"t": cols["t"][i], "kind": "disengage", "label": "Automation off (takeover)", "glyph": "−"})
    if "is_distracted" in cols and "is_distracted" in events_from:
        for i in edges(cols["is_distracted"], True): events.append({"t": cols["t"][i], "kind": "distracted", "label": "DMS: distraction flagged", "glyph": "!"})
    events.sort(key=lambda e: e["t"])
    sig = {"schema": "signals/1", "id": clip_id, "hz": hz, "n": n, "t0": 0.0, "duration_s": num(n / hz, 2), "cols": cols,
           "labels": {k: LABELS[k] for k in present if k in LABELS}, "units": {k: UNITS[k] for k in present if k in UNITS},
           "ranges": {k: [0, 1] for k in present if k in STATE_COLS and k != "lane_change_state"},
           "codes": {"lane_change_state": {"0": "off", "1": "pre", "2": "starting", "3": "finishing"}} if "lane_change_state" in cols else {},
           "shade": [{"col": "cc_enabled", "color": "accent", "alpha": 0.12, "label": "automation engaged"}] if "cc_enabled" in cols else [],
           "events": events, "series": [], "bands": [], "fans": [], "thresholds": [], "meta": {"source": "BATON-layout route CSVs", "window_s": num(t_b - t_a, 1)}}
    return sig

def timeline_from_signals(sig, lane_col="cc_enabled", lane_label="automation", extra=(("is_distracted", "DMS"),)):
    t = sig["cols"]["t"]; span = [0.0, num(sig["duration_s"], 2)]
    def lane(col, label, kinds):
        segs, marks = [], []
        c = sig["cols"].get(col)
        if c is None: return None
        start, cur = 0.0, None
        for i, v in enumerate(c):
            b = None if v is None else (1 if v else 0)
            if cur is None: cur = b; continue
            if b != cur: segs.append([start, t[i], "on" if cur == 1 else "off" if cur == 0 else "na"]); start = t[i]; cur = b
        segs.append([start, span[1], "on" if cur == 1 else "off" if cur == 0 else "na"])
        for e in sig["events"]:
            if e["kind"] in kinds: marks.append({"t": e["t"], "kind": e["kind"], "label": e["label"]})
        return {"id": col, "label": label, "segs": segs, "marks": marks}
    lanes = [l for l in [lane(lane_col, lane_label, ("engage", "disengage"))] + [lane(c, lb, ("distracted",)) for c, lb in extra] if l]
    return {"schema": "timeline/1", "span": span, "lanes": lanes, "meta": {"from": sig.get("id")}}

# COCO-WholeBody part ranges in the 133-point index space
PARTS133 = {"body": (0, 17), "feet": (17, 23), "face": (23, 91), "lhand": (91, 112), "rhand": (112, 133)}

def kpts_from_odms_npz(npz_path, meta=None, window=None, seq_id="seq", hz=10, part_names=None, aspect=None, jump_shoulder=0.08, jump_yaw=0.6, interp_max=3):
    """ODMS v0.1 npz (t, kpts[N,133,3] normalised x,y,score, mask, head[N,3], can[N,4], part_valid[N,P]) → kpts/1.
    window = (i0, i1) frame slice. Applies the tracker-jump filter (mask + interpolate ≤ interp_max frames)."""
    z = np.load(npz_path, allow_pickle=True)
    kp = np.asarray(z["kpts"], float)
    if kp.shape[1] != 133: raise ValueError(f"expected 133 keypoints, got {kp.shape[1]}")
    t = np.asarray(z["t"], float) if "t" in z.files else np.arange(len(kp)) / hz
    head = np.asarray(z["head"], float) if "head" in z.files else None
    can = np.asarray(z["can"], float) if "can" in z.files else None
    pv = np.asarray(z["part_valid"]) if "part_valid" in z.files else None
    mask = np.asarray(z["mask"], bool) if "mask" in z.files else None
    if window:
        i0, i1 = window; kp, t = kp[i0:i1], t[i0:i1]
        head = head[i0:i1] if head is not None else None; can = can[i0:i1] if can is not None else None
        pv = pv[i0:i1] if pv is not None else None; mask = mask[i0:i1] if mask is not None else None
    n = len(kp)
    xy = kp[..., :2].copy(); sc = kp[..., 2].copy()
    valid = np.isfinite(xy).all(-1) & np.isfinite(sc) & (sc > 0)
    if mask is not None and mask.ndim == 2: valid &= mask.astype(bool)
    # tracker-jump filter
    filtered = []
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning); sh = np.nanmean(np.where(valid[:, 5:7, None], xy[:, 5:7], np.nan), axis=1)  # shoulder centre
    for f in range(1, n):
        jump = np.hypot(*(sh[f] - sh[f - 1])) if np.isfinite(sh[f]).all() and np.isfinite(sh[f - 1]).all() else 0.0
        yaw_jump = abs(head[f, 0] - head[f - 1, 0]) if head is not None and np.isfinite(head[f, 0]) and np.isfinite(head[f - 1, 0]) else 0.0
        if jump > jump_shoulder or yaw_jump > jump_yaw: filtered.append(f)
    for f in filtered: valid[f, :] = False
    # interpolate short masked runs (≤ interp_max consecutive frames) per joint
    for j in range(133):
        v = valid[:, j]; f = 0
        while f < n:
            if v[f]: f += 1; continue
            g = f
            while g < n and not v[g]: g += 1
            if f > 0 and g < n and (g - f) <= interp_max:
                for q in range(f, g):
                    u = (q - f + 1) / (g - f + 1)
                    xy[q, j] = xy[f - 1, j] * (1 - u) + xy[g, j] * u; sc[q, j] = min(sc[f - 1, j], sc[g, j]) * 0.6; v[q] = True
            f = g
    xy = np.where(valid[..., None], xy, 0.0); sc8 = np.where(valid, np.clip(np.nan_to_num(sc) * 255, 1, 255), 0).astype(np.uint8)
    scale = 10000
    inter = np.empty(n * 133 * 2, dtype="<i2"); inter[0::2] = np.clip(np.round(xy[..., 0].ravel() * scale), -32000, 32000); inter[1::2] = np.clip(np.round(xy[..., 1].ravel() * scale), -32000, 32000)
    vx, vy = xy[..., 0][valid], xy[..., 1][valid]
    if len(vx) == 0: raise ValueError("no valid keypoints")
    x0, x1 = np.percentile(vx, [1, 99]); y0, y1 = np.percentile(vy, [1, 99]); mx, my = (x1 - x0) * 0.15, (y1 - y0) * 0.15
    out = {"schema": "kpts/1", "id": seq_id, "hz": hz, "n": n, "K": 133, "kpt_set": "wholebody_133", "enc": "b64le-int16", "scale": scale,
           "kpts": b64_i16(inter), "score": b64_u8(sc8.ravel()),
           "head": {"yaw": nums(head[:, 0]), "pitch": nums(head[:, 1]), "roll": nums(head[:, 2])} if head is not None else None,
           "can": None, "part_valid": None, "aspect": num(aspect or (meta or {}).get("aspect") or 16 / 9, 4),
           "crop": [num(x0 - mx, 4), num(y0 - my, 4), num(x1 + mx, 4), num(y1 + my, 4)], "filtered_frames": filtered, "labels": (meta or {}).get("labels") or {}, "meta": {}}
    if can is not None and can.shape[1] >= 4:
        out["can"] = {"t": nums(t - t[0], 2), "v_ego_mps": nums(can[:, 0]), "steer_deg": nums(can[:, 1]), "gas": [None if not np.isfinite(v) else int(v > 0.5) for v in can[:, 2]], "brake": [None if not np.isfinite(v) else int(v > 0.5) for v in can[:, 3]]}
    if pv is not None and pv.ndim == 2:
        names = list(part_names or ([f"part{i}" for i in range(pv.shape[1])]))
        out["part_valid"] = {"names": names[: pv.shape[1]], "v": b64_u8((pv > 0).astype(np.uint8).ravel())}
    return out

def embedding_from_tsne(xy, dims, reps=None, purity=None, meta=None):
    """xy: (n,2) floats; dims: {name: list[str] of length n}; reps: [{dim,name,label,i}] → embedding/1."""
    xy = np.asarray(xy, float); n = len(xy)
    bb = [float(xy[:, 0].min()), float(xy[:, 1].min()), float(xy[:, 0].max()), float(xy[:, 1].max())]
    xi = np.round((xy[:, 0] - bb[0]) / (bb[2] - bb[0] or 1) * 64000 - 32000).astype("<i2"); yi = np.round((xy[:, 1] - bb[1]) / (bb[3] - bb[1] or 1) * 64000 - 32000).astype("<i2")
    inter = np.empty(2 * n, dtype="<i2"); inter[0::2] = xi; inter[1::2] = yi
    D = {}
    for name, labels in dims.items():
        labels = list(labels)
        if len(labels) != n: raise ValueError(f"dim {name} length {len(labels)} ≠ n")
        uniq = sorted(set(labels), key=lambda s: (len(s), s)); idx = {u: i for i, u in enumerate(uniq)}
        if len(uniq) > 65535: raise ValueError(f"dim {name} has too many categories")
        D[name] = {"names": uniq, "idx": b64_u16(np.array([idx[l] for l in labels], dtype="<u2"))}
    out = {"schema": "embedding/1", "n": n, "bbox": [num(v, 4) for v in bb], "xy_i16": b64_i16(inter), "dims": D, "reps": reps or [], "meta": meta or {}}
    if purity: out["purity"] = purity
    return out

def knn_purity(Z, labels, k=10, max_n=20000, seed=0):
    """fraction of a point's k nearest neighbours (euclidean) sharing its label; Z (n,d). Subsamples queries beyond max_n."""
    Z = np.asarray(Z, np.float32); labels = np.asarray(labels); n = len(Z)
    rng = np.random.default_rng(seed); q = np.arange(n) if n <= max_n else rng.choice(n, max_n, replace=False)
    sq = (Z ** 2).sum(1); agree = 0.0
    for s in range(0, len(q), 512):
        qi = q[s:s + 512]; d = sq[qi, None] - 2 * Z[qi] @ Z.T + sq[None, :]; d[np.arange(len(qi)), qi] = np.inf
        nn = np.argpartition(d, k, axis=1)[:, :k]; agree += (labels[nn] == labels[qi, None]).mean(1).sum()
    return float(agree / len(q))


# ---------------------------------------------------------------- media
def ffprobe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt,width,height,r_frame_rate:format=duration,size", "-of", "json", path], capture_output=True, text=True, check=True)
    j = json.loads(r.stdout); s = j["streams"][0]
    return {"codec": s.get("codec_name"), "pix_fmt": s.get("pix_fmt"), "width": s.get("width"), "height": s.get("height"), "fps": s.get("r_frame_rate"), "duration": float(j["format"]["duration"]), "bytes": int(j["format"]["size"])}

def h264(src, dst, t_a=None, t_b=None, crf=26, scale=None, fps=None, extra_vf=None):
    vf = ["scale=trunc(iw/2)*2:trunc(ih/2)*2" if not scale else scale, "format=yuv420p"]
    if extra_vf: vf = [extra_vf] + vf
    if fps: vf = [f"fps={fps}"] + vf
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if t_a is not None: cmd += ["-ss", f"{t_a:.3f}"]
    cmd += ["-i", src]
    if t_b is not None and t_a is not None: cmd += ["-t", f"{t_b - t_a:.3f}"]
    cmd += ["-vf", ",".join(vf), "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-g", "40", "-movflags", "+faststart", "-an", dst]
    subprocess.run(cmd, check=True); return dst

def hstack(src_l, src_r, dst, t_a=None, t_b=None, crf=26, height=400):
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for s in (src_l, src_r):
        if t_a is not None: cmd += ["-ss", f"{t_a:.3f}"]
        cmd += ["-i", s]
    cmd += ["-filter_complex", f"[0:v]scale=-2:{height}[a];[1:v]scale=-2:{height}[b];[a][b]hstack=inputs=2,format=yuv420p[v]", "-map", "[v]"]
    if t_b is not None and t_a is not None: cmd += ["-t", f"{t_b - t_a:.3f}"]
    cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-g", "40", "-movflags", "+faststart", "-an", dst]
    subprocess.run(cmd, check=True); return dst

def fit_cap(render, dst, cap_bytes, crf0=26):
    """render(crf, scale) must write dst; bumps crf by 2 up to 34, then scales to 0.75."""
    crf, scale = crf0, None
    while True:
        render(crf, scale)
        if os.path.getsize(dst) <= cap_bytes: return crf, scale
        if crf < 34: crf += 2
        elif scale is None: scale = "scale=trunc(iw*0.75/2)*2:trunc(ih*0.75/2)*2"
        else: return crf, scale

def poster(src, dst, t, q=4):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", src, "-frames:v", "1", "-q:v", str(q), dst], check=True); return dst

def lqip(img_path):
    """24-px-wide JPEG q40 as a base64 data URI (≤ ~500 B)."""
    from PIL import Image
    im = Image.open(img_path).convert("RGB"); im.thumbnail((24, 24)); import io
    buf = io.BytesIO(); im.save(buf, "JPEG", quality=40, optimize=True); return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

def jpeg_fit(src, dst, max_w=2000, cap_bytes=350_000, q0=82, box=None, blur_boxes=None):
    """PIL resize + progressive JPEG, quality stepped down by 6 until under cap; optional crop box and blur boxes (normalised)."""
    from PIL import Image, ImageFilter
    im = Image.open(src); im = im.convert("RGB")
    if box: W, H = im.size; im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
    for b in (blur_boxes or []):
        W, H = im.size; reg = (int(b[0] * W), int(b[1] * H), int(b[2] * W), int(b[3] * H)); im.paste(im.crop(reg).filter(ImageFilter.GaussianBlur(24)), reg)
    if im.width > max_w: im = im.resize((max_w, int(im.height * max_w / im.width)), Image.LANCZOS)
    q = q0
    while True:
        im.save(dst, "JPEG", quality=q, optimize=True, progressive=True)
        if os.path.getsize(dst) <= cap_bytes or q <= 40: return q
        q -= 6


# ---------------------------------------------------------------- ledger (idempotent exports)
class Ledger:
    def __init__(self, path): self.path = path; self.rows = {}
    def load(self):
        if os.path.exists(self.path):
            for line in open(self.path): line = line.strip(); r = json.loads(line) if line else None; r and self.rows.__setitem__(r["id"], r)
        return self
    def done(self, item_id, h): r = self.rows.get(item_id); return bool(r and r.get("hash") == h)
    def mark(self, item_id, h, **kw):
        self.rows[item_id] = dict(id=item_id, hash=h, **kw)
        with open(self.path, "a") as f: f.write(json.dumps(self.rows[item_id]) + "\n")

def entry_hash(entry, *source_paths):
    h = hashlib.sha1(json.dumps(entry, sort_keys=True).encode() + PIPELINE_VERSION.encode())
    for p in source_paths:
        if p and os.path.exists(p): st = os.stat(p); h.update(f"{p}|{st.st_size}|{int(st.st_mtime)}".encode())
    return h.hexdigest()
