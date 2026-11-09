#!/usr/bin/env python3
"""VTT page · licence-plate pass over a cut / exported forward-camera clip (public outputs only: no raw paths, ids or times).

No plate detector or OCR model is available offline, and a gradient-energy plate localiser locked onto lamps and missed real
plates, so every frame goes through YOLO11x (COCO vehicles) and each CLOSE vehicle (box width >= WMIN of the camera frame, not a
pure side view) gets a blur box over the part of its visible face where a plate can sit. Plates range from the tailgate (~35-45 %
of the box height on an SUV seen from behind) to the bumper (~85 %), so the band runs 30-95 % of the height (55-95 % on a box
taller than wide: loaded trailer, van or bus rear, where the plate is low); frontal / rear views (aspect <= FRONTAL, not cut by the
frame edge) keep the central 56 % of the width (plates are centred, lamps lie outside), oblique or cut views take the full width.
Below WMIN a plate is under ~30 px wide at 526 px and not legible after the page's H.264 encode. Gaps of <= GAP frames between
detections are bridged with the boxes of both neighbours (detector flicker). For the rendered animation the detector runs inside
the embedded camera image, found as the dark rectangle of the first frame (camera_roi).

Output vtt_plates/<clip>.json: sig {width, height, fps, duration, n_frames, sha256 of the scanned file}, rule, boxes {frame:
[[x0,y0,x1,y1], ...]} in clip pixels, manual [[t0_s,t1_s,x0,y0,x1,y1], ...] = fixed boxes kept across re-scans (edit by hand for a
plate the detector cannot see). vtt_export.py runs this script itself ($PY of env.sh = openpilot venv, ultralytics + CUDA) when the
table is missing or does not match the cut, then blurs the boxes as it writes the clip. By hand:
    source ~/Desktop/Drive/VehicleTypeTraj/env.sh && cd tools/projpipe && $PY vtt_plate_scan.py case5 [--src cut.mp4] [--diag DIR]"""
import argparse, hashlib, json, os, subprocess
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); MEDIA = os.path.normpath(os.path.join(HERE, "..", "..", "vtt", "static", "media")); OUT = os.path.join(HERE, "vtt_plates")
WEIGHTS = os.environ.get("VTT_YOLO", os.path.expanduser("~/Desktop/Drive/OpenDriver/Dataset/loader/yolo11x.pt"))
VEH = [2, 3, 5, 7]                                      # COCO car, motorcycle, bus, truck
WMIN, ASPECT_MAX, FRONTAL, TALL, GAP = 0.22, 3.0, 1.5, 0.95, 10
EMBEDDED = {"anim"}                                      # rendered frames with the camera image embedded
def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for ch in iter(lambda: f.read(1 << 20), b""): h.update(ch)
    return h.hexdigest()
def ffprobe(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", p], capture_output=True, text=True, check=True)
    j = json.loads(r.stdout); s = j["streams"][0]; a, b = s["r_frame_rate"].split("/"); return dict(width=s["width"], height=s["height"], fps=round(float(a) / float(b), 3), duration=round(float(j["format"]["duration"]), 2))
def _run(frac, thr):
    """longest run of indices with frac > thr → (start, stop)."""
    ok = frac > thr; best = (0, 0); i = 0
    while i < len(ok):
        if ok[i]:
            j = i
            while j < len(ok) and ok[j]: j += 1
            if j - i > best[1] - best[0]: best = (i, j)
            i = j
        else: i += 1
    return best
def camera_roi(frame, thr=235):
    """(x, y, w, h) of the embedded camera image in a rendered frame: the longest run of columns (upper 70 % of the frame) and then rows that are mostly not background-white."""
    H = frame.shape[0]; dark = frame.min(axis=2) < thr
    x0, x1 = _run(dark[: int(0.7 * H)].mean(axis=0), 0.5); y0, y1 = _run(dark[:, x0:x1].mean(axis=1), 0.5); return int(x0), int(y0), int(x1 - x0), int(y1 - y0)
def face_box(x0, y0, x1, y1, rw, rh, wmin):
    """blur box (ROI pixels) for one vehicle box, or None when the vehicle is too far / a pure side view (see the module docstring for the band)."""
    w, h = x1 - x0, y1 - y0
    if w < wmin * rw or h <= 0 or w / h > ASPECT_MAX: return None
    top = y0 + (0.55 if h / w >= TALL else 0.30) * h; cut = x0 <= 1 or x1 >= rw - 1
    bx = (x0 + 0.22 * w, top, x1 - 0.22 * w, y0 + 0.95 * h) if (w / h <= FRONTAL and not cut) else (x0 + 0.04 * w, top, x1 - 0.04 * w, y0 + 0.95 * h)
    return [int(max(0, bx[0])), int(max(0, bx[1])), int(min(rw, bx[2])), int(min(rh, bx[3]))]
def scan(clip, src, wmin, diag, diag_step):
    pr = ffprobe(src); W, H = pr["width"], pr["height"]
    from ultralytics import YOLO
    model = YOLO(WEIGHTS); cap = cv2.VideoCapture(src); frames = []
    while True:
        ok, fr = cap.read()
        if not ok: break
        frames.append(fr)
    n = len(frames); rx, ry, rw, rh = camera_roi(frames[0]) if clip in EMBEDDED else (0, 0, W, H)
    if clip in EMBEDDED: print(f"   embedded camera image at x={rx} y={ry} {rw}x{rh} (aspect {rw / max(1, rh):.3f}; the camera is 1.594)")
    boxes, vehs = {}, {}
    for s in range(0, n, 32):
        batch = [f[ry:ry + rh, rx:rx + rw] for f in frames[s:s + 32]]
        for k, r in enumerate(model.predict(batch, imgsz=640, conf=0.25, classes=VEH, device=0, half=True, verbose=False)):
            i = s + k
            for xyxy in r.boxes.xyxy.cpu().numpy():
                x0, y0, x1, y1 = [float(v) for v in xyxy]; vehs.setdefault(i, []).append([round(x0 + rx), round(y0 + ry), round(x1 + rx), round(y1 + ry)])
                b = face_box(x0, y0, x1, y1, rw, rh, wmin)
                if b: boxes.setdefault(i, []).append([b[0] + rx, b[1] + ry, b[2] + rx, b[3] + ry])
    idx = sorted(boxes)                                  # bridge short gaps with the boxes of both neighbours
    for a, b in zip(idx, idx[1:]):
        if 1 < b - a <= GAP + 1:
            for i in range(a + 1, b): boxes[i] = boxes[a] + boxes[b]
    old = os.path.join(OUT, clip + ".json"); prev = json.load(open(old)) if os.path.exists(old) else {}
    table = {"clip": clip, "sig": {**pr, "n_frames": n, "sha256": sha256_file(src)}, "rule": {"wmin": wmin, "aspect_max": ASPECT_MAX, "frontal": FRONTAL, "tall": TALL, "band": "height 30-95 % (55-95 % if taller than wide); width central 56 % frontal / rear, full oblique or edge-cut", "gap_frames": GAP, "roi": [rx, ry, rw, rh], "detector": os.path.basename(WEIGHTS), "classes": VEH},
             "scanner": hashlib.sha1(open(__file__, "rb").read()).hexdigest()[:12],
             "boxes": {str(i): boxes[i] for i in sorted(boxes)}, "manual": prev.get("manual", []),
             "note": "boxes: frame index -> [x0,y0,x1,y1] clip pixels over the lower face of each close vehicle (vtt_plate_scan.py); manual: [t0_s,t1_s,x0,y0,x1,y1] fixed boxes, kept across re-scans"}
    os.makedirs(OUT, exist_ok=True); json.dump(table, open(old, "w"), separators=(",", ":"))
    runs, cur = [], None
    for i in sorted(boxes) + [None]:
        if i is not None and cur and i - cur[1] <= pr["fps"] * 0.5: cur[1] = i
        else:
            if cur: runs.append(cur)
            cur = [i, i] if i is not None else None
    print(f"{clip}: {n} frames @ {pr['fps']:g} fps, vehicles in {len(vehs)} frames, blur boxes in {len(boxes)} frames ({sum(len(v) for v in boxes.values())} boxes), manual {len(table['manual'])}")
    print("   blur runs (s):", ", ".join(f"{a / pr['fps']:.1f}-{(b + 1) / pr['fps']:.1f}" for a, b in runs) or "none")
    if diag:
        d = os.path.join(diag, clip); os.makedirs(d, exist_ok=True); tiles = []
        for i in [i for i in range(0, n, int(diag_step)) if any(v[2] - v[0] >= 0.7 * wmin * rw for v in vehs.get(i, []))]:
            f = frames[i].copy()
            for v in vehs.get(i, []): cv2.rectangle(f, (v[0], v[1]), (v[2], v[3]), (0, 200, 0), 1)
            for b in boxes.get(i, []): cv2.rectangle(f, (b[0], b[1]), (b[2], b[3]), (0, 0, 255), 2)
            cv2.putText(f, f"{clip} f{i} t={i / pr['fps']:.1f}", (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 0), 1); tiles.append(f)
        cols, per = 6, 30
        for s in range(0, len(tiles), per):
            ch = tiles[s:s + per]; rows = (len(ch) + cols - 1) // cols; h, w = ch[0].shape[:2]; S = np.full((rows * (h + 4), cols * (w + 4), 3), 225, np.uint8)
            for k, t in enumerate(ch): y, x = (k // cols) * (h + 4), (k % cols) * (w + 4); S[y:y + h, x:x + w] = t
            cv2.imwrite(os.path.join(d, f"diag_{s // per:02d}.jpg"), S, [cv2.IMWRITE_JPEG_QUALITY, 88])
if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("clips", nargs="+"); ap.add_argument("--src", help="mp4 to scan (default: the exported vtt/static/media/<clip>.mp4); one clip only")
    ap.add_argument("--wmin", type=float, default=WMIN); ap.add_argument("--diag"); ap.add_argument("--diag-step", type=float, default=10); A = ap.parse_args()
    assert not (A.src and len(A.clips) > 1), "--src takes one clip"
    for c in A.clips: scan(c, A.src or os.path.join(MEDIA, c + ".mp4"), A.wmin, A.diag, A.diag_step)
