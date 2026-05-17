// Browser-side config for @huggingface/transformers: load the embedding
// model from our own R2 bucket instead of HuggingFace's CDN. HF refuses CORS
// requests from the deployed origin, so we mirror the model files (~33 MB
// total) to a CORS-enabled bucket we control.
//
// Side-effect import: this module sets `env.*` at module init and must run
// before any pipeline() call. The Node-side indexer never imports this file
// and continues to fetch from HF as usual.

import { env } from "@arkiv-search/shared/embedding"

env.allowLocalModels = false
env.allowRemoteModels = true
env.remoteHost = "https://assets.arkiv-search.seweryn.dev/"
// Override the default `{model}/resolve/{revision}/` template so URLs come
// out as `${remoteHost}models/Xenova/bge-small-en-v1.5/${file}`.
env.remotePathTemplate = "models/{model}/"
