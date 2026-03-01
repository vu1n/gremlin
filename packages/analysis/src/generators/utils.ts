/**
 * Shared utilities for test generators.
 */

/**
 * Escape a string for safe inclusion in generated single-quoted string literals.
 *
 * Handles: backslash, single quote, backtick, newline, carriage return, tab.
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
