/**
 * The first value of a Next.js `searchParams` entry, which is a string, a list
 * (a repeated `?x=1&x=2`) or missing. Returns the value untouched: callers
 * trim, validate or fall back themselves.
 */
export function firstParam(value: string | string[] | undefined): string | undefined;
export function firstParam(value: unknown): unknown;
export function firstParam(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}
