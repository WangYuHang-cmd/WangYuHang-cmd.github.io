# OpenLKA web-showcase pipeline (WP3)

Turns raw comma-3X route logs (`rlog` + `qcamera.ts`) into the small, validated JSON/MP4 bundles under
`openlka/static/can/` that the CAN-lab front-end (`static/can.js`) renders. This folder is the source of
truth; it is mirrored to the lab server and executed there.

* Remote host: `henry@100.122.237.116`, scripts at `/home/henry/Desktop/Drive/Code4Dataset/web_showcase/`
* Python: `/home/henry/Desktop/Drive/openpilot/.venv/bin/python` (capnp, cantools 39, pandas 2.2, numpy, zstandard, PyYAML)
* Lab decoder (imported unmodified, never edited): `/home/henry/Zhouhaoseu Dropbox/Yuhang Wang/OP_CAN_DataProcessing`
  (`ReadRlogOpAttr.read_route_log_into_df`, `CAN_decoder_functions`, `DBC_files/`; git commit recorded in every `meta.json`)
* Raw data (read-only): `/data/datasets/raw/Dataset/<CAR_DIR>/<dongle>/<route>/<seg>--{rlog,qlog,qcamera.ts}`
* Work dir: `/data/datasets/temporary/web_showcase/{cache,clips,site}` (keep < 2 GB; disk is 98 % full)

## Stages

| stage | script | output |
|---|---|---|
| A | `scan_qlogs_showcase.py [--dongle D] [--workers 8]` | `cache/qlog_feat.jsonl` (per segment: speed, cruise/op/pressed fractions, blinker s, video anchor, eastern time, GPS fix) + `cache/gps_1hz.csv`; ~0.09 s/segment |
| B | `scan_rlogs_can.py --route <rel_path> \| --all [--car-dir X] [--dongle D] [--workers 8]` | `cache/can_feat.jsonl` - per segment: speed stats, stock lateral-active fraction (`STOCK_SPEC` rule on the stock bus), openpilot echo fraction (`op_tx`), lane-model probs/deviation, pedals, blinkers, lane-change seconds, video anchor, first GPS fix, eastern time, bus table, LKA transitions; ~2 s/segment/worker |
| aggregates | `build_aggregates.py [--only dongles\|signals\|map]` | `dongles.json`, `signal_availability.json` (STOCK_SPEC + regex over the lab decoder + DBC VAL tables + stage-B seen flags), `routes_map.json` (1 Hz -> 0.1 Hz -> RDP 0.00015 deg, <= 600 KB) |
| C | `select_clips.py --route <rel_path> [--table]` + `timeline.py --route <rel_path> --segments a-b` + hand edit | `clips.yaml` (ranked steady runs; 1 Hz timeline of speed / stock active / echoes / blinker / lane-change / probs / deviation / line codes) |
| D | `export_clip.py --spec clips.yaml --id <id> [--hz 10] [--out site/can] [--force]` | `site/can/<id>/{clip.mp4,poster.jpg,signals.json,track.json,frames.json,meta.json}` |
| review | `review.py --id <id> --sheet` then `review.py --id <id> --status ok --by <name> --note "..."` | contact sheet (poster + frames at 15/50/85 %) for the visual check; then sets `meta.privacy.manual_review`; re-run `build_index.py` afterwards |
| index | `build_index.py [--site site/can] [--default <id>] [--validate-only]` | `index.json`, `hero-trace.json`, `SHA256SUMS` + validation |
| publish | `publish.sh push` / `publish.sh pull` | scripts -> remote; `site/can/` -> `openlka/static/can/` (sha256 check, 30 MB gate) |

`common.py` holds `MAKE_MAP` (car_dir -> make key), `DECODERS` (make key -> lab decoder fn / ext dict / DBC),
`STOCK_SPEC` (per-make stock addresses, lateral-active rule, command addresses for echo detection, column
sources, units, lane-code semantics), the LogReader import (with the streaming-zstd patch), `read_log`,
`started_mono`, `video_anchor`, `stock_bus_table`, `echo_mask`, `spec_decode`, `decoder_for`, `lab_decode`,
provenance helpers (`decoder_commit`, `dbc_info`, `sha256_file`) and `check_spec()` (verifies every spec
signal exists in its DBC). Only the Hyundai/Kia spec is marked `verified`; others are best-effort until
their clips are exported and eyeballed.

## Typical run (fast path)

```bash
# local: push scripts
openlka/pipeline/publish.sh push
# remote
cd /home/henry/Desktop/Drive/Code4Dataset/web_showcase
PY=/home/henry/Desktop/Drive/openpilot/.venv/bin/python
$PY scan_rlogs_can.py --route HYUNDAI_IONIQ_5/bdda168c0c35fad7/0000003e--b9aaff0805 --workers 4
$PY export_clip.py --spec clips.yaml --id ioniq5-i275-stock-lfa
$PY build_index.py --default ioniq5-i275-stock-lfa
# local: pull into the repo, verify, gate
openlka/pipeline/publish.sh pull
```

## Conventions baked into the exporter

* **Clock.** Everything is in route seconds `(logMonoTime - deviceState.startedMonoTime)/1e9`, the same
  index the lab decoder uses. Wall-clock time (`clocks.wallTimeNanos`, what the lab's `easternTime` uses) is the
  device default `2023-11-21 16:10:5x` on many 530075 routes until time sync, so eastern times prefer
  `gpsLocation.unixTimestampMillis` (`meta.time_source`, stage-A/B `eastern_gps_t0`). Segment *i*'s video does not start at 60 i: `t_video0(i)` is read from
  `qRoadEncodeIdx.timestampSof`; `ffprobe start_time - timestampSof/1e9 = +0.0148 s` (PTS is based on the
  end-of-frame timestamp) and the exporter asserts `|err| < 0.03 s` per touched segment (`video.alignment_err_s`).
* **Frame mapping.** `t_a` is snapped to the next video frame boundary, so clip frame *k* is exactly `t_a + k/20`
  and `signals.t0_video_s == 0`. Source frame *k* has PTS `(k - 0.002) * 50 ms` relative to the stream start (about
  0.1 ms *below* the grid), so the ffmpeg `trim` is placed at half-frame boundaries (`ss - 25 ms`); the exporter
  verifies with ffprobe that the first cut frame is the intended one (`meta.video.cut_check`) - a plain
  `trim=start=ss` silently starts one frame late. The clip duration is a whole number of `1/hz` samples
  (`hz` must divide 20).
* **Stock vs openpilot.** CAN frames with `src >= 128` are openpilot's own transmitted commands; stock state is
  read only from `src < 128` on the most frequent bus per address (`meta.can.stock_bus`). `op_tx` = an echo of the
  make's steering-command address within +/-0.15 s. Clips labelled "stock" must show `op_tx_pct == 0`.
* **Lane geometry.** `lane_dev_m = (yL0 + yR0)/2` with modelV2 `+y` to the right, so **+ = car left of lane
  centre** (lab convention `LogProcess.calculate_lka_error`); `lane_width_m = yR0 - yL0`; both `null` when
  `min(prob_l, prob_r) < 0.3`.
* **Lab decoder.** `read_route_log_into_df` is run on every touched segment with a FRESH extension dict
  (`{k: {} for k in cdf.X_can_msg_dict}` - the module-level dicts alias state between calls) and a message
  *list* (it iterates twice). If `startedMonoTime` is absent, `ReadRlogOpAttr_new.read_route_log_into_df_new`
  is used. The lab column that mirrors the stock state (`lka_active` for Hyundai/Kia) is compared with the
  spec-decoded `lka_on` in `meta.lab_crosscheck`.
* **Curvature sign.** openpilot's `controlsState.curvature` is + right (planner frame); it is negated on export so
  `curvature_1pm` is + left like `steer_angle_deg`, and the validator requires corr(steer_angle_deg, curvature_1pm) > 0.
* **JSON.** `null` never `NaN`; floats 3 dp, probabilities 2 dp; columnar `cols` exactly as the schema (+ make-specific
  `extra` columns). `frames.json`: dense block (+/-0.08 s at the key moment) + 1 Hz background (3 stock-spec frames per
  second), <= 600 frames / <= 80 KB (`common.CAPS`, shared by exporter and validator).
* **Publishing gates.** Only clips with `privacy.manual_review == "ok"` enter `index.json`, the totals and `SHA256SUMS`
  (`build_index.py --allow-pending` is for local development only; the default clip must be reviewed). "stock" clips must
  have `op_tx_pct == 0`, `openpilot_steering` clips must have echoes. `meta.json` carries no server paths (basenames only).
  `publish.sh pull` rsyncs into a temp dir, verifies SHA256SUMS (fatal) and the 30 MB gate, then swaps it in.
* **Paths** come from env vars with the lab defaults: `OPENLKA_OP_DIR`, `OPENLKA_LAB_DIR`, `OPENLKA_RAW_DIR`,
  `OPENLKA_ROUTE_MASTER`, `OPENLKA_WORK_DIR`.
* **Privacy.** Source video is not blurred; windows are highway-only; `meta.privacy.manual_review` stays
  `"pending"` until a person has looked at the poster and sampled frames.

## Clip set (clips.yaml, 2026-10-01)

Nine clips over the three recorders: Ioniq 5 (bdda, default), Mach-E (530075), Accord at night (bdda, the only
echo-free Accord route), Camry TSS2 (bdda), Tiguan (bdda), RAV4 TSS2 lane-departure pulses (bdda; no echo-free
RAV4 route has sustained LTA), Niro interchange-ramp curve (bdda), EV6 (d5a6), and the 530075 Ioniq 5 night-rain
route with openpilot steering (labelled as such). Tesla has no clip: `DAS_autopilotState` is 0 (DISABLED) in every
scanned Model 3 segment of both recorders and the lab DBC carries no EPAS/steering-control messages; the 530075
Model 3 routes are openpilot-steered (echoes on 0x488/0x2B9/0x108).

## Schema

The unified JSON schema (index.json, signals.json, track.json, frames.json, meta.json, hero-trace.json) is
defined in the project plan, section "WP3 - Unified JSON schema"; `common.SIGNAL_COLS` is the authoritative
column list and `common.CAPS` the size caps enforced by `export_clip.py` / `build_index.py`.

## Rules

* `os.nice(10)`, at most 4 worker processes on the server.
* Never write under `/data/datasets/raw`; never edit the lab decoder files.
* Re-running export for an unchanged `clips.yaml` entry is a no-op (entry hash in `meta.json`); use `--force` to rebuild.
