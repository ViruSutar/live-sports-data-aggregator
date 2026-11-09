import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_PATH: z.string().default('data/matches.sqlite'),
  PROVIDER_A_WEBHOOK_URL: z.string().url().default('http://localhost:3000/webhooks/provider-a'),
  PROVIDER_B_BASE_URL: z.string().url().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  PRIMARY_PROVIDER: z.enum(['provider-a', 'provider-b']).default('provider-a'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const formatted = result.error.format();
      throw new Error(`Invalid environment configuration: ${JSON.stringify(formatted)}`);
    }
    _env = result.data;
  }
  return _env;
}
