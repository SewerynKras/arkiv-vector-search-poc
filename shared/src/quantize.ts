// Per-vector INT8 quantization.
//
// scale = max(abs(v)) / 127
// q[i]  = round(v[i] / scale) clamped to [-127, 127]
//
// Wire format: 4-byte little-endian float32 scale, then `dim` int8 values.
// Total = 4 + dim bytes (388 for dim=384).

export function quantizeInt8(v: Float32Array): Uint8Array {
  const dim = v.length;
  let maxAbs = 0;
  for (let i = 0; i < dim; i++) {
    const a = Math.abs(v[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs === 0 ? 1 : maxAbs / 127;
  const buf = new ArrayBuffer(4 + dim);
  new DataView(buf).setFloat32(0, scale, true);
  const q = new Int8Array(buf, 4, dim);
  for (let i = 0; i < dim; i++) {
    let x = Math.round(v[i]! / scale);
    if (x > 127) x = 127;
    else if (x < -127) x = -127;
    q[i] = x;
  }
  return new Uint8Array(buf);
}

export function dequantizeInt8(packed: Uint8Array): Float32Array {
  const dim = packed.byteLength - 4;
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const scale = view.getFloat32(0, true);
  const q = new Int8Array(packed.buffer, packed.byteOffset + 4, dim);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = q[i]! * scale;
  return out;
}

// dot(query, dequantize(packed)) without materializing a float copy.
// Hot path for reranking.
export function dotPackedInt8(query: Float32Array, packed: Uint8Array): number {
  const dim = packed.byteLength - 4;
  if (query.length !== dim) {
    throw new Error(`dim mismatch: query=${query.length} packed_dim=${dim}`);
  }
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const scale = view.getFloat32(0, true);
  const q = new Int8Array(packed.buffer, packed.byteOffset + 4, dim);
  let s = 0;
  for (let i = 0; i < dim; i++) s += query[i]! * q[i]!;
  return s * scale;
}
