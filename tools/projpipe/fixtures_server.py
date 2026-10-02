#!/usr/bin/env python3
"""DriveDNA embedding export (runs ON THE SERVER in the openpilot venv; pandas available there).
Reproduces make_embedding_map.py's selection (SEED 20260709, ≤ 60 windows per driver over data/segments/windows.parquet),
takes the matching t-SNE XY (figs_making/emb_tsne_xy.npz, same order as `sel`), joins pseudonymous labels from the
row-aligned hf_staging/data/windows.parquet, computes k=10 purity on the 128-d cache rows of the selected windows,
and writes embedding/1 JSON. No raw ids leave this script (write_json scans)."""
import os, sys, json, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import embedding_from_tsne, knn_purity, write_json, num
ROOT = "/home/henry/Desktop/Drive/DriveDNA"; OUT = sys.argv[1] if len(sys.argv) > 1 else "/data/datasets/temporary/web_showcase_proj/drivedna/embedding_drivedna.json"
SEED, CAP = 20260709, 60
W = pd.read_parquet(f"{ROOT}/data/segments/windows.parquet"); H = pd.read_parquet(f"{ROOT}/hf_staging/data/windows.parquet")
assert len(W) == len(H) == 62674
# row alignment check on shared, id-free columns
for c in ("model_canon", "t0", "wi0", "wi1", "scenario"):
    same = (W[c].values == H[c].values) | (pd.isna(W[c].values) & pd.isna(H[c].values))
    assert same.mean() > 0.999, f"column {c} not aligned ({same.mean():.4f})"
rng = np.random.default_rng(SEED)
sel = np.concatenate([rng.permutation(ix)[:CAP] for _, ix in W.groupby("driver").indices.items()])
XY = np.load(f"{ROOT}/figs_making/emb_tsne_xy.npz")["XY"]; assert len(XY) == len(sel) == 14930, (len(XY), len(sel))
Z = np.load(f"{ROOT}/figs_making/emb_cache_s1.npz")["Z"][sel]
Hs = H.iloc[sel].reset_index(drop=True)
drv = Hs["driver"].astype(str).tolist(); mod = Hs["model_canon"].astype(str).tolist(); scn = Hs["scenario"].astype(str).fillna("unknown").tolist()
assert all(d.startswith("driver_") for d in drv), "expected pseudonymous driver ids"
purity = {"k": 10, "driver": num(knn_purity(Z, np.array(drv), 10), 3), "model": num(knn_purity(Z, np.array(mod), 10), 3), "scenario": num(knn_purity(Z, np.array(scn), 10), 3),
          "note": "k-NN label agreement on the 128-d embeddings of the 14,930 mapped windows"}
# representatives: 8 drivers with 60 windows, largest XY spread, medoid index each
reps = []
g = Hs.groupby("driver").indices
known = lambda ix: str(Hs['model_canon'].iloc[ix[0]]).upper() not in ('UNKNOWN', 'NAN', 'NONE', '')
cands = sorted([(float(XY[ix].std(0).sum()), d) for d, ix in g.items() if len(ix) >= CAP and known(ix)], reverse=True)[:8]
for _, d in cands:
    ix = g[d]; m = XY[ix].mean(0); i = int(ix[np.argmin(((XY[ix] - m) ** 2).sum(1))])
    reps.append({"dim": "driver", "name": d, "label": f"{d} · {Hs['model_canon'].iloc[i]} · {len(ix)} windows", "i": i})
E = embedding_from_tsne(XY, {"driver": drv, "model": mod, "scenario": scn}, reps=reps, purity=purity,
                        meta={"source": "DriveDNA · t-SNE of 128-d window embeddings (PatchTST+SupCon), ≤ 60 windows per driver, 428 drivers", "n_drivers": int(Hs["driver"].nunique()), "n_models": int(Hs["model_canon"].nunique()), "seed": SEED})
os.makedirs(os.path.dirname(OUT), exist_ok=True); n, h = write_json(OUT, E); print(f"wrote {OUT} {n/1024:.1f} KB purity={purity} drivers={E['meta']['n_drivers']}")
