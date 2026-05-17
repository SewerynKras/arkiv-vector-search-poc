// IVF helpers. Embeddings and centroids are assumed L2-normalized;
// cosine similarity == dot product.

export function dot(a: Float32Array, b: Float32Array, aOff = 0, bOff = 0, dim = a.length): number {
  let s = 0;
  for (let i = 0; i < dim; i++) s += a[aOff + i]! * b[bOff + i]!;
  return s;
}

export function l2NormalizeInPlace(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n === 0) return;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
}

// Score all C centroids against a query vector. `centroids` is row-major (C * dim).
export function scoreCentroids(
  query: Float32Array,
  centroids: Float32Array,
  dim: number,
  C: number,
): Float32Array {
  const scores = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    scores[c] = dot(query, centroids, 0, c * dim, dim);
  }
  return scores;
}

// Top-K argmax over scores, descending.
export function topK(scores: Float32Array | number[], k: number): number[] {
  const n = scores.length;
  const idx = new Array<number>(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  idx.sort((a, b) => (scores[b] as number) - (scores[a] as number));
  return idx.slice(0, Math.min(k, n));
}

// Top-M nearest centroids for one embedding.
export function assignTopM(
  embedding: Float32Array,
  centroids: Float32Array,
  dim: number,
  C: number,
  M: number,
): number[] {
  return topK(scoreCentroids(embedding, centroids, dim, C), M);
}
