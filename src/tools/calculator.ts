import type { ToolDefinition } from '../types/index.js';

/**
 * Safe arithmetic evaluator.
 *
 * We deliberately do NOT use eval() or new Function(): those execute arbitrary
 * JavaScript, which is a classic security hole when the input comes from an
 * LLM. Instead we tokenize and parse the expression with a tiny
 * recursive-descent parser supporting + - * /, parentheses, and decimals.
 */

type Token = { type: 'number'; value: number } | { type: 'op'; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const char = expression[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let num = '';
      while (i < expression.length && /[0-9.]/.test(expression[i]!)) {
        num += expression[i]!;
        i++;
      }
      const value = Number.parseFloat(num);
      if (Number.isNaN(value)) throw new Error(`Invalid number: "${num}"`);
      tokens.push({ type: 'number', value });
      continue;
    }
    if ('+-*/()'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      i++;
      continue;
    }
    throw new Error(`Unsupported character: "${char}"`);
  }
  return tokens;
}

/**
 * Grammar (standard precedence climbing):
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/') factor)*
 *   factor     := number | '(' expression ')' | ('-' | '+') factor
 */
function evaluate(tokens: Token[]): number {
  let pos = 0;

  function peekOp(): string | undefined {
    const token = tokens[pos];
    return token?.type === 'op' ? token.value : undefined;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (peekOp() === '+' || peekOp() === '-') {
      const op = peekOp()!;
      pos++;
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peekOp() === '*' || peekOp() === '/') {
      const op = peekOp()!;
      pos++;
      const rhs = parseFactor();
      value = op === '*' ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    const token = tokens[pos];
    if (!token) throw new Error('Unexpected end of expression');
    if (token.type === 'number') {
      pos++;
      return token.value;
    }
    if (token.value === '-') {
      pos++;
      return -parseFactor();
    }
    if (token.value === '+') {
      pos++;
      return parseFactor();
    }
    if (token.value === '(') {
      pos++;
      const value = parseExpression();
      if (peekOp() !== ')') throw new Error('Missing closing parenthesis');
      pos++;
      return value;
    }
    throw new Error(`Unexpected token: "${token.value}"`);
  }

  const result = parseExpression();
  if (pos !== tokens.length) throw new Error('Unexpected trailing input');
  return result;
}

export function calculate(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('Empty expression');
  const result = evaluate(tokens);
  if (!Number.isFinite(result)) {
    throw new Error('Result is not a finite number (division by zero?)');
  }
  return result;
}

export const calculatorTool: ToolDefinition = {
  name: 'calculator',
  description:
    'Evaluate a basic arithmetic expression with +, -, *, /, parentheses and decimals. Example input: "2 * (3 + 4)".',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'The arithmetic expression to evaluate.' },
    },
    required: ['expression'],
  },
  execute: (input) => {
    const expression = input.expression;
    if (typeof expression !== 'string') {
      return 'Error: "expression" must be a string.';
    }
    try {
      return String(calculate(expression));
    } catch (error) {
      // Tool errors are returned as text so the model can see what went wrong
      // and adapt, instead of crashing the whole loop.
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
