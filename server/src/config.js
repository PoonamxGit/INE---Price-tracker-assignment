import { z } from "zod";
export function configFromEnv(env = process.env) {
  return z
    .object({
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      SUPABASE_URL: z.url(),
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
      FRONTEND_URL: z.url(),
      CRON_SECRET: z.string().min(32),
      SCRAPER_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(10000)
        .max(60000)
        .default(45000),
      SCRAPER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(3).default(3),
    })
    .parse(env);
}
