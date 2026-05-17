// Read raw_articles.jsonl, chunk into paragraphs, write chunks.jsonl.
// Embedding is a separate step (03-embed.ts) so the slow part can be run
// on its own dispatch (GPU sidecar vs Node CPU).

import { readJsonl, dataPath, writeJsonl } from './lib/io.js';

const TARGET_CHUNKS = Number(process.env.CHUNKS ?? 5000);
const MIN_CHARS = 200;
const MAX_CHARS = 1500;

interface RawArticle { id: string; url: string; title: string; text: string }
interface ChunkRow {
  chunk_index: number;
  parent_doc_id: string;
  title: string;
  url: string;
  text: string;
}

function* paragraphChunks(article: RawArticle): Generator<Omit<ChunkRow, 'chunk_index'>> {
  const paragraphs = article.text.split(/\n\s*\n/);
  for (const raw of paragraphs) {
    const para = raw.trim().replace(/\s+/g, ' ');
    if (para.length < MIN_CHARS) continue;
    // Split overly long paragraphs into sentence-ish slices of ~MAX_CHARS.
    let cursor = 0;
    while (cursor < para.length) {
      const remaining = para.length - cursor;
      let end: number;
      if (remaining <= MAX_CHARS) {
        end = para.length;
      } else {
        // try to break at a period within the last 200 chars of the window
        const window = para.slice(cursor, cursor + MAX_CHARS);
        const dotAt = window.lastIndexOf('. ', MAX_CHARS - 1);
        end = dotAt > MAX_CHARS - 300 ? cursor + dotAt + 1 : cursor + MAX_CHARS;
      }
      const slice = para.slice(cursor, end).trim();
      if (slice.length >= MIN_CHARS) {
        yield { parent_doc_id: article.id, title: article.title, url: article.url, text: slice };
      }
      cursor = end;
    }
  }
}

async function main() {
  const articlesPath = dataPath('raw_articles.jsonl');
  const chunksPath = dataPath('chunks.jsonl');

  console.log(`Reading articles from ${articlesPath}`);
  console.log(`Target: ${TARGET_CHUNKS} chunks (min ${MIN_CHARS}, max ${MAX_CHARS} chars)`);

  async function* gen() {
    let count = 0;
    for await (const article of readJsonl<RawArticle>(articlesPath)) {
      for (const c of paragraphChunks(article)) {
        yield { chunk_index: count, ...c };
        count++;
        if (count >= TARGET_CHUNKS) return;
      }
    }
  }
  const n = await writeJsonl(chunksPath, gen());
  console.log(`Wrote ${n} chunks → ${chunksPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
