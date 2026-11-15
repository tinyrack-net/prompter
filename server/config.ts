import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /** Base URL of the Outline instance, e.g. https://notes.example.com */
  OUTLINE_URL: z.url().transform((url) => url.replace(/\/+$/, '')),
  /** Outline API key (Settings → API & Apps). Read access is enough. */
  OUTLINE_API_KEY: z.string().min(1),
  /** Secret of the Outline webhook subscription used to verify deliveries. */
  OUTLINE_WEBHOOK_SECRET: z.string().min(1),
  /** Outline's own origin for links back to documents, if different from OUTLINE_URL. */
  OUTLINE_PUBLIC_URL: z
    .url()
    .optional()
    .transform((url) => url?.replace(/\/+$/, '')),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof schema> & { OUTLINE_PUBLIC_URL: string };

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    OUTLINE_PUBLIC_URL: parsed.data.OUTLINE_PUBLIC_URL ?? parsed.data.OUTLINE_URL,
  };
}
