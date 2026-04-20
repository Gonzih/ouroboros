import { describe, it, expect } from 'vitest'
import { shouldKeepLine } from '../filter.js'

describe('shouldKeepLine', () => {
  it('keeps a normal output line', () => {
    expect(shouldKeepLine('Some output text', null)).toBe(true)
  })

  it('suppresses [tool] TodoWrite lines', () => {
    expect(shouldKeepLine('[tool] TodoWrite {"todos":[]}', null)).toBe(false)
  })

  it('suppresses [tool] ToolSearch lines', () => {
    expect(shouldKeepLine('[tool] ToolSearch {"query":"foo"}', null)).toBe(false)
  })

  it('keeps [tool] Bash lines', () => {
    expect(shouldKeepLine('[tool] Bash {"command":"npm test"}', null)).toBe(true)
  })

  it('keeps [tool] Edit lines', () => {
    expect(shouldKeepLine('[tool] Edit {"file_path":"/foo/bar.ts"}', null)).toBe(true)
  })

  it('keeps [tool] Write lines', () => {
    expect(shouldKeepLine('[tool] Write {"file_path":"/foo"}', null)).toBe(true)
  })

  it('keeps [tool] Read lines', () => {
    expect(shouldKeepLine('[tool] Read {"file_path":"/foo"}', null)).toBe(true)
  })

  it('keeps [cc-agent:done] lines', () => {
    expect(shouldKeepLine('[cc-agent:done] Task complete', null)).toBe(true)
  })

  it('keeps lines containing "error"', () => {
    expect(shouldKeepLine('Something went wrong: error in module', null)).toBe(true)
  })

  it('keeps lines containing "Error"', () => {
    expect(shouldKeepLine('TypeError: cannot read property', null)).toBe(true)
  })

  it('keeps lines containing "failed"', () => {
    expect(shouldKeepLine('Build failed with 3 errors', null)).toBe(true)
  })

  it('suppresses pure whitespace lines', () => {
    expect(shouldKeepLine('   ', null)).toBe(false)
    expect(shouldKeepLine('', null)).toBe(false)
  })

  it('suppresses separator lines (---)', () => {
    expect(shouldKeepLine('---', null)).toBe(false)
  })

  it('suppresses duplicate consecutive lines', () => {
    expect(shouldKeepLine('same line', 'same line')).toBe(false)
  })

  it('keeps identical lines that are not consecutive', () => {
    expect(shouldKeepLine('same line', 'different line')).toBe(true)
  })

  it('always keeps error lines even if they match suppress patterns (error beats suppress)', () => {
    // A line that would normally be suppressed but contains "error" — error wins
    // because ALWAYS_KEEP is checked after suppress but the logic checks always-keep first
    expect(shouldKeepLine('[tool] TodoWrite failed with Error', null)).toBe(true)
  })
})
