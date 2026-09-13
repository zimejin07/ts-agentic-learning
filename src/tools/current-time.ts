import { z } from 'zod';
import type { ToolDefinition } from '../types/index.js';

/**
 * Returns the current date/time. LLMs have no sense of "now", so this is the
 * canonical example of why agents need tools at all.
 */
export const currentTimeTool: ToolDefinition = {
  name: 'current_time',
  description:
    'Get the current date and time. Optionally pass an IANA timezone like "Europe/London" or "America/New_York".',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'IANA timezone name, e.g. "America/New_York". Defaults to the local timezone.',
      },
    },
    required: [],
  },
  argsSchema: z.object({ timezone: z.string().optional() }),
  execute: (input) => {
    const timezone =
      typeof input.timezone === 'string' && input.timezone.trim()
        ? input.timezone.trim()
        : undefined;
    const now = new Date();
    try {
      const formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone: timezone,
      }).format(now);
      return `ISO: ${now.toISOString()} | Local: ${formatted}${timezone ? ` (${timezone})` : ''}`;
    } catch {
      return `Error: unknown timezone "${timezone}". Use an IANA name like "Europe/London".`;
    }
  },
};
