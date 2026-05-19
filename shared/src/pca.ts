// Top-K PCA via power iteration. Cheap and deterministic enough for an
// interactive visualisation of cluster centroids in 2D/3D.
//
// X is row-major (N rows × D columns). Returns:
//   components: K × D — orthonormal principal axes (rows)
//   projected:  N × K — each row's projection onto those axes
//   mean:       D     — mean used to center X
//   variance:   K     — per-component variance (eigenvalue, descending)
//
// At N=2048, D=384, K=3 this runs in ~300 ms in pure JS V8 — long enough
// that the client runs it in a Web Worker (see viz3d/pca-worker.ts).

export interface PcaResult {
  components: Float32Array; // K * D
  projected: Float32Array;  // N * K
  mean: Float32Array;       // D
  variance: number[];       // length K
  N: number; D: number; K: number;
}

function dot(a: Float32Array, aOff: number, b: Float32Array, bOff: number, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[aOff + i]! * b[bOff + i]!;
  return s;
}

function multiplyXtX_v(X: Float32Array, N: number, D: number, v: Float32Array, out: Float32Array) {
  // out = X^T X v  =  X^T (X v)
  // First compute Xv (length N), then X^T (Xv) (length D).
  const Xv = new Float32Array(N);
  for (let i = 0; i < N; i++) Xv[i] = dot(X, i * D, v, 0, D);
  out.fill(0);
  for (let i = 0; i < N; i++) {
    const xi = Xv[i]!;
    const base = i * D;
    for (let d = 0; d < D; d++) out[d] = out[d]! + X[base + d]! * xi;
  }
}

function l2NormalizeInPlace(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  const n = Math.sqrt(s);
  if (n === 0) return 0;
  const inv = 1 / n;
  for (let i = 0; i < v.length; i++) v[i] = v[i]! * inv;
  return n;
}

export function pca(X: Float32Array, N: number, D: number, K: number, opts: { iters?: number; seed?: number } = {}): PcaResult {
  const iters = opts.iters ?? 80;
  // Center.
  const mean = new Float32Array(D);
  for (let i = 0; i < N; i++) {
    const base = i * D;
    for (let d = 0; d < D; d++) mean[d] = mean[d]! + X[base + d]!;
  }
  for (let d = 0; d < D; d++) mean[d] = mean[d]! / N;
  const Xc = new Float32Array(N * D);
  for (let i = 0; i < N; i++) {
    const base = i * D;
    for (let d = 0; d < D; d++) Xc[base + d] = X[base + d]! - mean[d]!;
  }

  // Power iteration with deflation.
  const components = new Float32Array(K * D);
  const variance: number[] = [];
  const v = new Float32Array(D);
  const Cv = new Float32Array(D);

  // Seeded RNG (mulberry32) for determinism.
  let s = (opts.seed ?? 1) | 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  for (let k = 0; k < K; k++) {
    for (let d = 0; d < D; d++) v[d] = rng() - 0.5;
    l2NormalizeInPlace(v);

    let lambda = 0;
    for (let it = 0; it < iters; it++) {
      multiplyXtX_v(Xc, N, D, v, Cv);
      // Deflate against earlier components.
      for (let kp = 0; kp < k; kp++) {
        const proj = dot(Cv, 0, components, kp * D, D);
        for (let d = 0; d < D; d++) Cv[d] = Cv[d]! - proj * components[kp * D + d]!;
      }
      // Rayleigh quotient for eigenvalue estimate.
      lambda = dot(v, 0, Cv, 0, D);
      const n = l2NormalizeInPlace(Cv);
      if (n === 0) break;
      v.set(Cv);
    }
    components.set(v, k * D);
    variance.push(lambda / (N - 1));
  }

  // Project Xc onto components → N × K.
  const projected = new Float32Array(N * K);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < K; k++) projected[i * K + k] = dot(Xc, i * D, components, k * D, D);
  }

  return { components, projected, mean, variance, N, D, K };
}
