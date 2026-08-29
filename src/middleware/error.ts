import { HTTPException } from 'hono/http-exception';
import type { ErrorHandler } from 'hono';
import type { AppEnv } from './request-id.js';

/**
 * Uniform JSON errors: { error, requestId }.
 * Zod / zValidator failures arrive as HTTPException 400.
 */
export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  if (err instanceof HTTPException) {
    const status = err.status;
    return c.json({ error: err.message || 'Request failed', requestId }, status);
  }

  console.error(
    JSON.stringify({ level: 'error', requestId, message: err.message, stack: err.stack }),
  );
  return c.json({ error: 'Internal Server Error', requestId }, 500);
};
