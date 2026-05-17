"""GPU embedding sidecar using pytorch with manual mean pooling.

Replicates the *exact* embedding pipeline used by the browser client
(`shared/src/embedding.ts` which uses Xenova/bge-small-en-v1.5 via
@huggingface/transformers): tokenize → encoder → mean pool with attention
mask → L2 normalize. Importantly we do NOT use sentence-transformers
because its default pooling for bge-small is CLS, which produces different
embeddings (verified empirically: ~0.92 cosine vs Xenova ONNX). Mean pool
brings us back to ~0.997 cosine vs the browser path.

We use the pytorch weights from BAAI rather than the Xenova ONNX so we get
fast GPU inference on Pascal (which has poor INT8 throughput). The
precision delta vs INT8 ONNX is ~0.003 cosine, far inside the recall budget.

    python embed_gpu.py --in chunks.jsonl --out embeddings.f32 [--batch 64] [--fp16]
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModel, AutoTokenizer

MODEL_ID = "BAAI/bge-small-en-v1.5"
DIM = 384
MAX_SEQ_LENGTH = 512


def load_chunks(path: Path) -> list[str]:
    texts: list[str] = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            texts.append(row["text"])
    return texts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", dest="out", required=True)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    ap.add_argument("--model", default=MODEL_ID)
    ap.add_argument("--fp16", action="store_true", help="use half precision on GPU")
    ap.add_argument("--max-seq-length", type=int, default=MAX_SEQ_LENGTH)
    args = ap.parse_args()

    inp = Path(args.inp)
    out = Path(args.out)

    print(f"device={args.device}", file=sys.stderr)
    if args.device.startswith("cuda"):
        print(f"  gpu={torch.cuda.get_device_name(0)} cap={torch.cuda.get_device_capability(0)}", file=sys.stderr)

    print(f"loading {args.model} ...", file=sys.stderr)
    tok = AutoTokenizer.from_pretrained(args.model)
    dtype = torch.float16 if args.fp16 and args.device.startswith("cuda") else torch.float32
    model = AutoModel.from_pretrained(args.model, dtype=dtype).to(args.device).eval()

    print(f"reading chunks from {inp} ...", file=sys.stderr)
    texts = load_chunks(inp)
    n = len(texts)
    print(f"  n={n}", file=sys.stderr)
    if n == 0:
        return 2

    # Sort by length to reduce padding waste; remember the original order.
    order = sorted(range(n), key=lambda i: len(texts[i]))
    inv_order = [0] * n
    for pos, orig in enumerate(order):
        inv_order[orig] = pos
    sorted_texts = [texts[i] for i in order]

    out_arr = np.empty((n, DIM), dtype=np.float32)
    t0 = time.time()
    last_log = t0

    with torch.inference_mode():
        for i in range(0, n, args.batch):
            batch = sorted_texts[i : i + args.batch]
            enc = tok(
                batch,
                padding=True,
                truncation=True,
                max_length=args.max_seq_length,
                return_tensors="pt",
            ).to(args.device)
            outputs = model(**enc).last_hidden_state  # (B, T, D)
            mask = enc["attention_mask"].unsqueeze(-1).to(dtype)
            summed = (outputs * mask).sum(dim=1)
            denom = mask.sum(dim=1).clamp(min=1e-9)
            pooled = summed / denom
            pooled = torch.nn.functional.normalize(pooled, p=2, dim=1)
            arr = pooled.detach().to(torch.float32).cpu().numpy()
            for j, vec in enumerate(arr):
                out_arr[order[i + j]] = vec

            now = time.time()
            if now - last_log > 5 or i + args.batch >= n:
                done = min(i + args.batch, n)
                rate = done / max(now - t0, 1e-9)
                eta = (n - done) / max(rate, 1e-9)
                print(f"  {done}/{n}  {rate:.0f} chunks/s  eta {eta:.0f}s", file=sys.stderr)
                last_log = now

    dt = time.time() - t0
    print(f"embedded {n} in {dt:.1f}s ({n/dt:.0f}/s)", file=sys.stderr)

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("wb") as f:
        f.write(out_arr.astype("<f4").tobytes())
    print(f"wrote {n} * {DIM} float32 → {out} ({out.stat().st_size} bytes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
