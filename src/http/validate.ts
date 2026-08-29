import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { ZodType } from 'zod';

/**
 * zValidator that throws HTTPException so our onError handler always
 * returns the { error, requestId } envelope (including Zod failures).
 */
export function validate<T extends ZodType>(target: 'json' | 'param', schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      const first = result.error.issues[0]?.message ?? 'Invalid request';
      throw new HTTPException(400, { message: first });
    }
  });
}
