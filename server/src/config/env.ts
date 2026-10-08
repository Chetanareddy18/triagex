import 'dotenv/config';
import { z } from 'zod';

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const DEV_ACCESS = 'dev-access-secret-change-me-0123456789';
const DEV_REFRESH = 'dev-refresh-secret-change-me-0123456789';
const DEV_AUDIT = 'dev-audit-signing-key-change-me-0123456789';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/triagex'),
    CLIENT_ORIGIN: z.string().default('http://localhost:5173'),

    JWT_ACCESS_SECRET: z.string().min(32).default(DEV_ACCESS),
    JWT_REFRESH_SECRET: z.string().min(32).default(DEV_REFRESH),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    COOKIE_SECURE: bool(false),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    ML_URL: z.string().default('http://127.0.0.1:8000'),
    ML_API_KEY: z.string().optional(),
    ML_TIMEOUT_MS: z.coerce.number().int().positive().default(2500),
    AI_AUTO_APPLY_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),

    ENABLE_SCHEDULER: bool(true),
    SLA_SCAN_CRON: z.string().default('*/30 * * * * *'),
    SLA_AT_RISK_RATIO: z.coerce.number().min(0.1).max(0.99).default(0.75),
    AUTO_ASSIGN_ON_BREACH: bool(true),

    AUDIT_SIGNING_KEY: z.string().min(32).default(DEV_AUDIT),
    ALERT_INGEST_KEY: z.string().optional(),

    LLM_PROVIDER: z.enum(['none', 'openai', 'anthropic']).default('none'),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    LLM_BASE_URL: z.string().optional(),

    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.NODE_ENV !== 'production') return;
    for (const [key, dev] of [
      ['JWT_ACCESS_SECRET', DEV_ACCESS],
      ['JWT_REFRESH_SECRET', DEV_REFRESH],
      ['AUDIT_SIGNING_KEY', DEV_AUDIT],
    ] as const) {
      if (cfg[key] === dev) ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be set in production` });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isTest = env.NODE_ENV === 'test';
export const llmEnabled = env.LLM_PROVIDER !== 'none' && Boolean(env.LLM_API_KEY);
export const clientOrigins = env.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
