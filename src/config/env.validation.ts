import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_MINUTE_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_HOUR_TTL: z.coerce.number().int().positive().default(3_600_000),
  THROTTLE_HOUR_LIMIT: z.coerce.number().int().positive().default(100),
  // Required — session store, throttler storage, and cache all depend on Redis.
  // Render Key Value add-on injects this automatically; for local dev use
  // redis://localhost:6379.  The app refuses to start when it is absent.
  REDIS_URL: z.string().url({ message: 'REDIS_URL must be a valid URL (e.g. redis://localhost:6379)' }),
  CACHE_TTL: z.coerce.number().int().positive().default(300_000),
  FRONTEND_URL: z.string().url().optional(),
  // OpenAI — required for query rewriting and future RAG steps.
  // Missing OPENAI_API_KEY will fail fast at startup before any request is served.
  OPENAI_API_KEY: z.string().min(1, { message: 'OPENAI_API_KEY is required' }),
  OPENAI_REWRITER_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-large'),
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce
    .number()
    .int()
    .positive({ message: 'OPENAI_EMBEDDING_DIMENSIONS must be a positive integer' })
    .default(3072),
  // Qdrant vector database — required for RAG indexing (Step I1+) and runtime search.
  // App refuses to start without these so misconfiguration surfaces immediately.
  QDRANT_URL: z.string().url({ message: 'QDRANT_URL must be a valid URL (e.g. https://your-cluster-id.qdrant.io)' }),
  QDRANT_API_KEY: z.string().min(1, { message: 'QDRANT_API_KEY is required' }),
  QDRANT_COLLECTION: z.string().default('personal_docs'),
});

export type Env = z.infer<typeof envSchema>;

export const validateEnv = (config: Record<string, unknown>): Env => {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
};
