"""GPU spherical k-means sidecar (PyTorch + CUDA).

Reads a packed float32 LE matrix `embeddings.f32` (N × dim row-major) and
writes `centroids.f32` (C × dim row-major). Same wire format as the TS
trainer in `indexer/src/lib/kmeans.ts`, so the downstream `assign-cells`
step works unchanged.

The TS trainer's k-means++ init is pure-JS and dominates wall-clock at
C=8192 (~12 min on N=96k). This script does the same job on GPU in under
a minute on a GTX 1060, because the bottleneck (N×dim dot products
against the running centroids) maps trivially onto cuBLAS.

    python kmeans_gpu.py --in embeddings.f32 --out centroids.f32 \\
        --dim 384 --C 8192 --max-iter 25 [--seed 1] [--batch 32768]

Algorithm matches the TS reference:
  - L2-normalize inputs (assumed already normalized; we renormalize cheaply).
  - k-means++ init weighted by (1 - cosine)² = squared cosine distance.
  - Lloyd's iterations: assign by argmax cosine, update by row-mean,
    re-normalize. Empty clusters re-initialised from random points.

Memory: peak ≈ (batch × C + N × dim) × 4 bytes. At N=400k, C=8192, batch=32k
that's ~1.6 GB — comfortably under a 6 GB card.
"""

import argparse
import sys
import time
from pathlib import Path

import numpy as np
import torch


def kmeans_pp_init(
    X: torch.Tensor,
    C: int,
    device: str,
    seed: int,
) -> torch.Tensor:
    """k-means++ init weighted by (1 - cosine)². Inputs assumed L2-normalized."""
    g = torch.Generator(device=device).manual_seed(seed)
    N, D = X.shape
    centroids = torch.empty((C, D), device=device, dtype=X.dtype)

    first = torch.randint(0, N, (1,), device=device, generator=g).item()
    centroids[0] = X[first]
    # cosine distance = 1 - X @ c. Clamp to avoid tiny negatives from fp noise.
    min_d = (1 - X @ centroids[0]).clamp(min=0)

    for c in range(1, C):
        # Sample probability is proportional to min_d (the squared-distance
        # variant of k-means++; for L2-normalized vectors and cosine sim,
        # min_d ≡ ‖x - c‖²/2, so weighting by min_d is the right thing).
        s = min_d.sum()
        if s <= 0:
            # Degenerate: pick uniformly at random (all points already at a
            # centroid). Rare; happens if N < C.
            pick = torch.randint(0, N, (1,), device=device, generator=g).item()
        else:
            probs = min_d / s
            pick = torch.multinomial(probs, 1, generator=g).item()
        centroids[c] = X[pick]
        new_d = (1 - X @ centroids[c]).clamp(min=0)
        min_d = torch.minimum(min_d, new_d)

    return centroids


def spherical_kmeans(
    X: torch.Tensor,
    C: int,
    max_iter: int,
    seed: int,
    batch: int,
    verbose: bool = True,
) -> torch.Tensor:
    device = X.device
    N, D = X.shape

    t0 = time.time()
    centroids = kmeans_pp_init(X, C, device.type, seed)
    centroids = torch.nn.functional.normalize(centroids, dim=1)
    print(f"  init: {time.time() - t0:.1f}s")

    assignments = torch.full((N,), -1, dtype=torch.long, device=device)
    one = torch.ones(N, dtype=torch.long, device=device)

    rng = torch.Generator(device=device.type).manual_seed(seed ^ 0xDEAD_BEEF)
    converged = False

    for it in range(max_iter):
        t_it = time.time()

        # ---- Assign ---------------------------------------------------------
        new_labels = torch.empty(N, dtype=torch.long, device=device)
        for i in range(0, N, batch):
            j = min(i + batch, N)
            sim = X[i:j] @ centroids.T  # (b, C)
            new_labels[i:j] = sim.argmax(dim=1)
        changed = int((new_labels != assignments).sum().item())
        assignments = new_labels

        # ---- Update ---------------------------------------------------------
        sums = torch.zeros((C, D), device=device, dtype=X.dtype)
        counts = torch.zeros(C, device=device, dtype=torch.long)
        sums.index_add_(0, assignments, X)
        counts.index_add_(0, assignments, one)

        empty = counts == 0
        if empty.any():
            empty_idx = torch.nonzero(empty).flatten()
            replace = torch.randint(0, N, (len(empty_idx),), device=device, generator=rng)
            sums[empty_idx] = X[replace]
            counts[empty_idx] = 1

        centroids = sums / counts.float().unsqueeze(1)
        centroids = torch.nn.functional.normalize(centroids, dim=1)

        if verbose:
            sizes = torch.bincount(assignments, minlength=C)
            non_empty = int((sizes > 0).sum().item())
            max_size = int(sizes.max().item())
            print(
                f"  iter {it}: changed={changed} non-empty={non_empty}/{C} "
                f"max={max_size} ({time.time() - t_it:.1f}s)"
            )

        if changed == 0:
            converged = True
            break

    print(f"  done in {time.time() - t0:.1f}s, converged={converged}")
    return centroids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--dim", type=int, default=384)
    ap.add_argument("--C", type=int, required=True)
    ap.add_argument("--max-iter", type=int, default=25)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--batch", type=int, default=32768)
    args = ap.parse_args()

    if not torch.cuda.is_available():
        print("WARNING: CUDA not available — running on CPU (will be very slow).", file=sys.stderr)
        device = torch.device("cpu")
    else:
        device = torch.device("cuda")
        print(f"device: {torch.cuda.get_device_name(0)}", flush=True)

    raw = np.fromfile(args.inp, dtype="<f4")
    N = raw.size // args.dim
    if N * args.dim != raw.size:
        raise SystemExit(
            f"file size {raw.size} not divisible by dim={args.dim} (got remainder {raw.size % args.dim})"
        )
    X = torch.from_numpy(raw.reshape(N, args.dim).copy()).to(device)
    # Defensive renormalize — the embedder should have done this, but fp drift
    # would slowly cosine-bias the result.
    X = torch.nn.functional.normalize(X, dim=1)

    print(
        f"N={N} D={args.dim} → training C={args.C} centroids "
        f"(max_iter={args.max_iter}, seed={args.seed}, batch={args.batch})",
        flush=True,
    )

    centroids = spherical_kmeans(
        X, args.C, args.max_iter, args.seed, args.batch, verbose=True
    )

    out = centroids.cpu().numpy().astype("<f4", copy=False).ravel()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    out.tofile(args.out)
    print(f"Wrote {args.C}*{args.dim} float32 → {args.out}")


if __name__ == "__main__":
    main()
