import pino from "pino";
export const logger = pino({
  redact: [
    "req.headers.authorization",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
  ],
});
