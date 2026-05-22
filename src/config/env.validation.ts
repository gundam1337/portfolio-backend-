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
