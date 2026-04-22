import { GoogleGenAI } from '@google/genai';
import { env } from '@/lib/env';

const MODEL = 'gemini-embedding-001';
const DIMS = 1536;

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

type TaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT';

async function embed(text: string, taskType: TaskType): Promise<number[]> {
  const response = await ai.models.embedContent({
    model: MODEL,
    contents: [text],
    config: {
      taskType,
      outputDimensionality: DIMS,
    },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values || values.length !== DIMS) {
    throw new Error(
      `embedContent returned ${values?.length ?? 0} dims, expected ${DIMS}`,
    );
  }
  return l2Normalize(values);
}

/** Normalize a vector to unit length. Throws on a zero-vector input. */
export function l2Normalize(v: readonly number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    throw new Error('l2Normalize received a zero vector');
  }
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / norm;
  return out;
}

/** Embed a natural-language query for retrieval (RETRIEVAL_QUERY, 1536 dims, L2-normalized). */
export function embedForQuery(text: string): Promise<number[]> {
  return embed(text, 'RETRIEVAL_QUERY');
}

/** Embed a memory content string for storage (RETRIEVAL_DOCUMENT, 1536 dims, L2-normalized). Used by phase 04. */
export function embedForDocument(text: string): Promise<number[]> {
  return embed(text, 'RETRIEVAL_DOCUMENT');
}

export const EMBEDDING_DIMS = DIMS;
export const EMBEDDING_MODEL = MODEL;
