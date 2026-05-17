"""Bulk-fetch Wikipedia articles from a single HF parquet file (no rate limits).

Replaces the 01-fetch-dataset.ts script which talked to the
datasets-server HTTP API and got 429'd at ~5k requests/hr.

    python fetch_dataset.py --out raw_articles.jsonl [-n 30000]
"""

import argparse
import json
import random
import sys
from pathlib import Path

from datasets import load_dataset

DATASET = "wikimedia/wikipedia"
CONFIG = "20231101.simple"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("-n", "--num", type=int, default=30000)
    ap.add_argument("--min-length", type=int, default=500)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"loading {DATASET}/{CONFIG} ...", file=sys.stderr)
    ds = load_dataset(DATASET, CONFIG, split="train")
    total = len(ds)
    print(f"  total rows: {total}", file=sys.stderr)

    rng = random.Random(args.seed)
    # Over-sample by 3x to allow for length filtering.
    sample_size = min(total, args.num * 3)
    indices = rng.sample(range(total), sample_size)

    kept = 0
    skipped_short = 0
    with out.open("w", encoding="utf-8") as f:
        for i in indices:
            row = ds[i]
            text = row.get("text", "")
            if len(text) < args.min_length:
                skipped_short += 1
                continue
            f.write(json.dumps({
                "id": row["id"],
                "url": row["url"],
                "title": row["title"],
                "text": text,
            }) + "\n")
            kept += 1
            if kept % 5000 == 0:
                print(f"  wrote {kept}", file=sys.stderr)
            if kept >= args.num:
                break

    print(f"wrote {kept} articles → {out} (skipped {skipped_short} too-short)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
