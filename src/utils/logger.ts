/**
 * Tiny console logger with one method per loop phase.
 * Uses raw ANSI codes instead of a color library to keep the dependency
 * footprint small — this is a learning project, so fewer moving parts is a
 * feature.
 */

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
} as const;

type Color = keyof typeof colors;

function paint(color: Color, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

export const log = {
  plan: (message: string) => console.log(paint('cyan', `[plan]    ${message}`)),
  act: (message: string) => console.log(paint('magenta', `[act]     ${message}`)),
  observe: (message: string) => console.log(paint('green', `[observe] ${message}`)),
  reflect: (message: string) => console.log(paint('yellow', `[reflect] ${message}`)),
  answer: (message: string) => console.log(paint('green', `[answer]  ${message}`)),
  warn: (message: string) => console.log(paint('red', `[warn]    ${message}`)),
  info: (message: string) => console.log(paint('dim', message)),
};
