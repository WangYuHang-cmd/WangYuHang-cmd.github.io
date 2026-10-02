# Project-page kit · data contracts (v1)

Binding for `assets/proj/proj.js` (consumer) and `tools/projpipe/` (producer). Every JSON file carries
`"schema": "<kind>/1"`; the kit's `Proj.assertShape(kind, obj)` checks the major version and the cheap
invariants listed under each kind before the first render. Any failure → the widget shows its
`figure.pj-fallback` and a one-line note; it never renders a partial payload.

Conventions
- Time `t` in seconds, float, monotonic, step `1/hz`. Missing samples are `null` (never `NaN`, never omitted).
- Columnar arrays: `len(cols.<k>) == n` for every column. Floats ≤ 3 dp unless a column says otherwise.
- Colours are token names resolved by the kit — `accent`, `accent-2`, `blue`, `violet`, `gold`, `mint`,
  `coral`, `cyan`, `white`, `mute`, `text` — or a raw `#rrggbb`.
- Binary columns are base64 of little-endian typed arrays (`b64le-int16`, `b64le-uint16`, `b64-uint8`).
- No raw device ids, route ids, GPS, paths or secrets anywhere (see `tools/projpipe/common.py FORBIDDEN`).
- Every file may carry a free `meta` object (provenance, captions); the kit only reads the keys listed here.

## manifest/1 — `<page>/static/data/manifest.json`
```jsonc
{ "schema":"manifest/1", "page":"tridrive", "generated":"2026-10-02", "pipeline_version":"1",
  "budget":{ "first_view_bytes":3000000, "total_media_bytes":25000000, "used_first_view":0, "used_total":0 },
  "files":{ "signals_ex01":{ "path":"static/data/signals_ex01.json", "sha256":"…64 hex…", "bytes":21345 } },
  "items":[ /* media + data items with privacy/provenance, see plan WP-D; the kit ignores items[] */ ] }
```
Kit: `<body data-manifest="static/data/manifest.json">`; `data-src="key:signals_ex01"` → `files[key].path + "?v=" + sha256[:8]`.
A plain `data-src="static/data/x.json"` bypasses the manifest (fixtures, dev).

## signals/1 — one clock, many channels (Scrubber)
```jsonc
{ "schema":"signals/1", "id":"ex01", "hz":10, "n":470, "t0":0.0, "duration_s":47.0,
  "cols":{ "t":[…], "v_ego_mps":[…], "badas_risk":[…], "ttc_s":[…], "is_distracted":[…] },
  "labels":{ "v_ego_mps":"speed", "badas_risk":"risk" },          // optional display names
  "units":{ "v_ego_mps":"m/s", "ttc_s":"s" },                       // optional
  "ranges":{ "badas_risk":[0,1] },                                   // optional fixed y-ranges per col
  "caps":{ "ttc_s":30 },                                             // optional: values ≥ cap were exported as null (drawn hatched "≥ cap")
  "codes":{ "lane_change_state":{ "0":"off", "1":"pre", "2":"starting", "3":"finishing" } },
  "shade":[ { "col":"cc_enabled", "color":"accent", "alpha":0.12, "label":"automation engaged" } ],   // 0/1 cols drawn as background runs
  "events":[ { "t":5.0, "kind":"onset", "label":"Distraction onset", "glyph":"!" } ],                // sorted by t, inside [t0, t0+duration]
  "series":[ { "id":"wm", "label":"BATON-WM score", "unit":"", "color":"accent", "style":"step",      // line | step | bars
               "window_s":5.0, "t":[…], "v":[…] } ],                                                   // t/v equal length; windowed scores end at window end
  "bands":[ { "id":"brake", "label":"brake", "color":"accent", "n":1033,
              "t":[…101…], "q":{ "10":[…], "25":[…], "50":[…], "75":[…], "90":[…] } } ],              // same length as t
  "fans":[ { "id":"onset", "label":"forecast at onset", "anchor_t":5.0, "step_s":0.2, "horizon_s":5.0,
             "p":[…25…], "contrib":{ "dis":[…], "gaze":[…], "hands":[…] } } ],                       // p in [0,1]
  "thresholds":[ { "col":"badas_risk", "v":0.5, "label":"illustrative threshold", "color":"coral", "style":"dash" } ],
  "media":{ "video":"static/media/ex01.mp4", "poster":"static/media/ex01.jpg", "t0_video_s":0.0, "aspect":"1280/400" },   // optional
  "meta":{ } }
```
Invariants: `n ≥ 2`, `cols.t` present and monotonic with step `1/hz` (± 1e-3), all `cols.*` length `n`,
`events[].t` inside the clip, `series[].t.length == series[].v.length`, each `bands[].q.*` length == `bands[].t.length`,
`fans[].p.length == round(horizon_s/step_s)`.

## clips/1 — clip index for a Scrubber with a picker
```jsonc
{ "schema":"clips/1", "default":"b", "clips":[ { "id":"b", "title":"Clip B", "sub":"phone · 37 s", "src":"static/data/signals_b.json", "video":"static/media/b.mp4", "poster":"static/media/b.jpg" } ] }
```

## timeline/1 — lanes of states + marks (Timeline; hero ribbon)
```jsonc
{ "schema":"timeline/1", "span":[0, 120.0],
  "lanes":[ { "id":"engaged", "label":"automation", "segs":[[0,12.3,"off"],[12.3,78.0,"on"]],
              "marks":[ { "t":12.3, "kind":"handover", "label":"Handover ↑" }, { "t":78.0, "kind":"takeover", "label":"Takeover ↓" } ] } ],
  "meta":{ } }
```
Invariants: `span[0] < span[1]`, every seg inside span with `t0 ≤ t1`, marks inside span. States: `on | off | na | <free>`.

## embedding/1 — 2-D points with categorical dims (Scatter)
```jsonc
{ "schema":"embedding/1", "n":14930, "bbox":[xmin,ymin,xmax,ymax],
  "xy_i16":"<b64le-int16, 2n values, x then y interleaved, scaled to bbox via int16 range −32000…32000>",
  "dims":{ "driver":{ "names":["driver_001",…], "idx":"<b64le-uint16, n values>" },
           "model":{ "names":[…], "idx":"<b64le-uint16>" }, "scenario":{ "names":[…], "idx":"<b64le-uint16>" } },
  "reps":[ { "dim":"driver", "name":"driver_143", "label":"driver_143 · Rivian R1T · 60 windows", "i":1234 } ],   // i = medoid point index
  "purity":{ "k":10, "driver":0.0, "model":0.0, "scenario":0.0 },     // optional, k-NN label agreement
  "meta":{ } }
```
Decode: `x = bbox[0] + (xi + 32000) / 64000 * (bbox[2] − bbox[0])` (same for y). Invariants: decoded lengths == `n`, every `idx` value < `names.length`.
Also used for ADAS-TO's TTC/THW long tail with dims `{critical}` and `meta.axes = {x:"min TTC (s)", y:"min THW (s)"}`.

## kpts/1 — keypoint sequences (Skeleton)
```jsonc
{ "schema":"kpts/1", "id":"aide_0829", "hz":10, "n":120, "K":133, "kpt_set":"wholebody_133",
  "enc":"b64le-int16", "scale":10000,
  "kpts":"<b64le-int16, n*K*2 values (x,y) normalised to the full frame, 0…1 may be exceeded>",
  "score":"<b64-uint8, n*K, 0…255 = per-joint confidence>",         // 0 = missing
  "head":{ "yaw":[…n…], "pitch":[…], "roll":[…] } | null,             // radians
  "can":{ "t":[…n…], "v_ego_mps":[…], "steer_deg":[…], "gas":[…], "brake":[…] } | null,
  "part_valid":{ "names":["face","body","lhand","rhand","lfoot","rfoot"], "v":"<b64-uint8, n*P>" } | null,
  "aspect":1.596,                                                      // frame W/H
  "crop":[x0,y0,x1,y1],                                                // normalised box to frame (1st–99th pct of valid points + 15 % margin)
  "filtered_frames":[…indices masked by the tracker-jump filter…],
  "labels":{ "behavior":"Body Movement", "emotion":"Weariness", "scene":"Smooth Traffic" },
  "meta":{ } }
```
Always the 133-point COCO-WholeBody index space (body 0–16, feet 17–22, face 23–90, left hand 91–111, right hand 112–132);
absent parts carry `score == 0`. The kit owns the bone topology. Invariants: decoded lengths == `n*K*2` / `n*K`, `aspect > 0`, `crop[0] < crop[2]`, `crop[1] < crop[3]`.

## paired/1 — before→after per subject (Paired: slope | dumbbell)
```jsonc
{ "schema":"paired/1", "mode":"slope", "axis":{ "min":1, "max":7, "label":"rating (1–7)" },
  "from":"openpilot DMS", "to":"TriDrive",
  "groups":[ { "id":"appropriateness", "label":"Appropriateness", "n":14, "delta":1.79, "ci":[0.86,2.75], "p":0.008,
               "cost":false, "rows":[ { "id":"P01", "a":3, "b":6 }, { "id":"P05", "a":null, "b":5 } ] } ],
  "meta":{ } }
```
`a`/`b` may be `null` (unpaired → hollow dot). Dumbbell mode: `rows[].label`, `rows[].emph` (true = full opacity), `axis.chance` (dashed line).

## bars/1 — magnitudes (Bars; also leaderboards)
```jsonc
{ "schema":"bars/1", "unit":"", "max":null, "rows":[ { "label":"zero-motion", "v":7.75, "v2":0.215, "color":"mute", "emph":false, "note":"persistence" } ], "meta":{ } }
```

## hist/1 — histograms (Hist; latency waterfalls)
```jsonc
{ "schema":"hist/1", "bin_w":2, "x0":0, "unit":"ms",
  "groups":[ { "id":"drive-1", "label":"Drive 1", "counts":[…200…], "p50":82.7, "p95":152.6, "n":6735, "ref":{ "p50":83, "p95":153, "label":"paper" } } ],
  "lines":[ { "v":300, "label":"300 ms p95 target", "color":"coral" } ], "meta":{ } }
```

## sources/1 — provenance list (chips [P]/[R]/[L])
```jsonc
{ "schema":"sources/1",
  "sources":[ { "id":"arxiv-2609.33000v1-abs", "kind":"arxiv", "url":"https://arxiv.org/abs/2609.33000v1", "version":"v1", "date":"2026-09-26",
                "locator":"Abstract", "quote":"48.05 vs. 71.47 All-MPJPE" },
              { "id":"hf-tridrive-card", "kind":"hf-card", "url":"https://huggingface.co/HenryYHW/TriDrive", "date":"2026-10-02", "locator":"README", "quote":"CC BY-SA 4.0" },
              { "id":"log-latency", "kind":"log", "url":null, "date":"2026-10-02", "locator":"pred_log.jsonl × 50 sessions", "quote":"p95 152.6 ms" } ] }
```
`kind ∈ arxiv | hf-card | hf-api | log | github` → chip letter P | R | R | L | R. `kind:"unpublished"` is rejected by the validator.
HTML: `<data class="n" value="48.05" data-src="arxiv-2609.33000v1-abs">48.05</data>`; the kit adds the chip + popover and links to `#src-<id>` in `<details class="sources">`.

## hf_meta/1 — `assets/proj/data/hf_meta.json`
```jsonc
{ "schema":"hf_meta/1", "fetched":"2026-10-02",
  "repos":{ "HenryYHW/TriDrive":{ "type":"model", "gated":"manual", "license":"cc-by-sa-4.0", "license_name":"CC BY-SA 4.0", "lastModified":"…", "sha":"…" } } }
```
`gated ∈ "auto" | "manual" | false`. Stamped into each page's `#data` band as static markup by `publish.sh` (no client-side HF fetch).

## numbers/1 — `<page>/static/data/numbers.json` (dev-time check target, from `tools/projpipe/registry.yaml`)
```jsonc
{ "schema":"numbers/1", "page":"tridrive",
  "numbers":{ "aide_mpjpe":{ "value":48.05, "fmt":"0.00", "unit":"All-MPJPE", "source":"arxiv-2609.33000v1-abs", "tag":"in the paper" } } }
```

## Transport bus (DOM events on `document`)
- `pj:time` `{group, t, hover, src}` ≤ 30 Hz from the active clock of a `data-sync` group.
- `pj:seek` `{group, t, play?}` any member may request; the group's clock owner applies it.
- `pj:hover` `{group, t|null}`.
- `pj:ready` `{el, widget}` after a widget's first full render.
