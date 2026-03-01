import { describe, test, expect } from 'bun:test';
import { formatDuration } from '../analytics-render.ts';

describe('formatDuration', () => {
  test('formats sub-second as milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  test('formats seconds with one decimal', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(5432)).toBe('5.4s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  test('formats minutes and seconds', () => {
    expect(formatDuration(60_000)).toBe('1m0s');
    expect(formatDuration(90_000)).toBe('1m30s');
    expect(formatDuration(125_000)).toBe('2m5s');
    expect(formatDuration(3_600_000)).toBe('60m0s');
  });

  test('boundary: exactly 1 second', () => {
    expect(formatDuration(1000)).toBe('1.0s');
  });

  test('boundary: exactly 1 minute', () => {
    expect(formatDuration(60_000)).toBe('1m0s');
  });

  test('handles fractional millisecond values', () => {
    expect(formatDuration(0.5)).toBe('1ms');
    expect(formatDuration(999.4)).toBe('999ms');
  });
});
