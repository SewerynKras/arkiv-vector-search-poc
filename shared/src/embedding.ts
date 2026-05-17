import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Re-export so callers configure the singleton through the same module
// they're using to embed — no second direct dep on transformers needed.
export { env };

export const MODEL_ID = 'Xenova/bge-small-en-v1.5';
export const MODEL_DTYPE = 'q8' as const;
export const EMBEDDING_DIM = 384;
export const MAX_SEQ_LENGTH = 512;

export type ModelProgress =
  | { status: 'initiate'; name: string; file: string }
  | { status: 'download'; name: string; file: string }
  | { status: 'progress'; name: string; file: string; loaded: number; total: number; progress: number }
  | { status: 'done'; name: string; file: string }
  | { status: 'ready'; task: string; model: string };

let _pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

export interface EmbedderOptions {
  onProgress?: (p: ModelProgress) => void;
}

export function getEmbedder(opts: EmbedderOptions = {}): Promise<FeatureExtractionPipeline> {
  if (!_pipelinePromise) {
    _pipelinePromise = (pipeline as unknown as (
      task: 'feature-extraction',
      model: string,
      pipelineOpts?: { dtype?: typeof MODEL_DTYPE; progress_callback?: (p: ModelProgress) => void },
    ) => Promise<FeatureExtractionPipeline>)('feature-extraction', MODEL_ID, {
      dtype: MODEL_DTYPE,
      ...(opts.onProgress ? { progress_callback: opts.onProgress } : {}),
    });
  }
  return _pipelinePromise;
}

// Embeds a batch of strings. Returns one Float32Array(EMBEDDING_DIM) per input,
// mean-pooled with attention mask and L2-normalized — the canonical bge-small recipe.
export async function embedBatch(texts: string[], opts: EmbedderOptions = {}): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder(opts);
  const output = await embedder(texts, {
    pooling: 'mean',
    normalize: true,
  });
  const data = output.data as Float32Array;
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
  }
  return out;
}

export async function embedOne(text: string, opts: EmbedderOptions = {}): Promise<Float32Array> {
  const [v] = await embedBatch([text], opts);
  return v!;
}
