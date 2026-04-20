// Lines to always drop — internal tool-tracking noise that adds no signal to job output.
const SUPPRESS_PATTERNS: RegExp[] = [
  /^\[tool\] TodoWrite/,
  /^\[tool\] ToolSearch/,
]

// Lines to always keep regardless of other rules.
const ALWAYS_KEEP_PATTERNS: RegExp[] = [
  /^\[tool\] (Bash|Edit|Write|Read)/,
  /^\[cc-agent:/,
  /error|Error|failed|Failed/,
]

/**
 * Returns true if `line` should be stored in job output.
 * `prevLine` is the last line that was kept (null at start) — used to drop consecutive duplicates.
 */
export function shouldKeepLine(line: string, prevLine: string | null): boolean {
  // Drop pure whitespace and separator lines
  if (line.trim() === '' || line.trim() === '---') return false

  // Always keep error / system / real-work tool lines
  if (ALWAYS_KEEP_PATTERNS.some(p => p.test(line))) return true

  // Drop noisy internal tool calls
  if (SUPPRESS_PATTERNS.some(p => p.test(line))) return false

  // Drop duplicate consecutive lines
  if (prevLine !== null && line === prevLine) return false

  return true
}
