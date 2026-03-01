/**
 * Tests for Playwright code generation helpers.
 *
 * Covers:
 * - generateLocator: testId, accessibility label, text, CSS selector, coordinates, fallback
 * - generateEventAction: tap, double_tap, input, submit, scroll, navigation, back, unknown
 */

import { describe, test, expect } from 'bun:test';
import { generateLocator, generateEventAction } from '../playwright-helpers.ts';
import type { TransitionEvent, ElementRef } from '../../spec/types.ts';

// ============================================================================
// generateLocator
// ============================================================================

describe('generateLocator', () => {
  test('returns body locator when no element provided', () => {
    expect(generateLocator()).toBe(`page.locator('body')`);
    expect(generateLocator(undefined)).toBe(`page.locator('body')`);
  });

  test('uses testId when available', () => {
    const element: ElementRef = { testId: 'submit-btn' };
    expect(generateLocator(element)).toBe(`page.getByTestId('submit-btn')`);
  });

  test('uses regex for testId with wildcard', () => {
    const element: ElementRef = { testId: 'item-*-delete' };
    const result = generateLocator(element);
    expect(result).toContain('page.getByTestId(/');
    expect(result).toContain('.first()');
    expect(result).toContain('item-.*-delete');
  });

  test('uses accessibility label when no testId', () => {
    const element: ElementRef = { accessibilityLabel: 'Close dialog' };
    expect(generateLocator(element)).toBe(`page.getByLabel('Close dialog')`);
  });

  test('uses button role for button type with text', () => {
    const element: ElementRef = { text: 'Submit', type: 'button' };
    expect(generateLocator(element)).toBe(`page.getByRole('button', { name: 'Submit' })`);
  });

  test('uses link role for link type with text', () => {
    const element: ElementRef = { text: 'Learn more', type: 'link' };
    expect(generateLocator(element)).toBe(`page.getByRole('link', { name: 'Learn more' })`);
  });

  test('uses getByText for text without special type', () => {
    const element: ElementRef = { text: 'Hello World', type: 'text' };
    expect(generateLocator(element)).toBe(`page.getByText('Hello World')`);
  });

  test('uses CSS selector when available', () => {
    const element: ElementRef = { cssSelector: '#main .content' };
    expect(generateLocator(element)).toBe(`page.locator('#main .content')`);
  });

  test('falls back to body for coordinates only', () => {
    const element: ElementRef = { coordinates: { x: 100, y: 200 } };
    expect(generateLocator(element)).toBe(`page.locator('body')`);
  });

  test('falls back to body for empty element', () => {
    const element: ElementRef = {};
    expect(generateLocator(element)).toBe(`page.locator('body')`);
  });

  test('prioritizes testId over other selectors', () => {
    const element: ElementRef = {
      testId: 'my-btn',
      accessibilityLabel: 'My Button',
      text: 'Click Me',
      cssSelector: '.btn',
    };
    expect(generateLocator(element)).toBe(`page.getByTestId('my-btn')`);
  });

  test('escapes special characters in testId regex', () => {
    const element: ElementRef = { testId: 'item-*.row' };
    const result = generateLocator(element);
    // The dot should be escaped in the regex pattern
    expect(result).toContain('\\.');
  });
});

// ============================================================================
// generateEventAction
// ============================================================================

describe('generateEventAction', () => {
  test('generates click for tap event', () => {
    const event: TransitionEvent = {
      type: 'tap',
      element: { testId: 'my-btn' },
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.getByTestId('my-btn').click();`);
  });

  test('generates dblclick for double_tap event', () => {
    const event: TransitionEvent = {
      type: 'double_tap',
      element: { testId: 'item' },
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.getByTestId('item').dblclick();`);
  });

  test('generates fill for input event with data', () => {
    const event: TransitionEvent = {
      type: 'input',
      element: { testId: 'email-input' },
      data: { value: 'test@example.com' },
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.getByTestId('email-input').fill('test@example.com');`);
  });

  test('generates fill with default value when no data', () => {
    const event: TransitionEvent = {
      type: 'input',
      element: { testId: 'search' },
    };
    const result = generateEventAction(event);
    expect(result).toContain("fill('test input')");
  });

  test('generates press Enter for submit with element', () => {
    const event: TransitionEvent = {
      type: 'submit',
      element: { testId: 'form' },
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.getByTestId('form').press('Enter');`);
  });

  test('generates keyboard Enter for submit without element', () => {
    const event: TransitionEvent = {
      type: 'submit',
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.keyboard.press('Enter');`);
  });

  test('generates mouse wheel for scroll event', () => {
    const event: TransitionEvent = {
      type: 'scroll',
      data: { deltaY: 300 },
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.mouse.wheel(0, 300);`);
  });

  test('generates scroll with default deltaY when not provided', () => {
    const event: TransitionEvent = {
      type: 'scroll',
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.mouse.wheel(0, 500);`);
  });

  test('generates goto for navigation with url', () => {
    const event: TransitionEvent = {
      type: 'navigation',
      data: { url: 'https://example.com/about' },
    };
    const result = generateEventAction(event);
    expect(result).toContain("page.goto('https://example.com/about')");
  });

  test('generates goto for navigation with path', () => {
    const event: TransitionEvent = {
      type: 'navigation',
      data: { path: '/products' },
    };
    const result = generateEventAction(event);
    expect(result).toContain("page.goto('/products')");
  });

  test('generates waitForURL for navigation with screen', () => {
    const event: TransitionEvent = {
      type: 'navigation',
      data: { screen: 'ProductList' },
    };
    const result = generateEventAction(event);
    expect(result).toContain('page.waitForURL');
    expect(result).toContain('ProductList');
  });

  test('generates waitForLoadState for navigation without data', () => {
    const event: TransitionEvent = {
      type: 'navigation',
    };
    const result = generateEventAction(event);
    expect(result).toContain("waitForLoadState('networkidle')");
  });

  test('generates goBack for back event', () => {
    const event: TransitionEvent = {
      type: 'back',
    };
    const result = generateEventAction(event);
    expect(result).toBe(`await page.goBack();`);
  });

  test('generates waitForLoadState for unknown event types', () => {
    const event: TransitionEvent = {
      type: 'app_background',
    };
    const result = generateEventAction(event);
    expect(result).toContain("waitForLoadState('networkidle')");
    expect(result).toContain('Unhandled event');
  });

  test('handles navigate alias for navigation', () => {
    const event = {
      type: 'navigate' as TransitionEvent['type'],
      data: { url: 'https://example.com' },
    };
    const result = generateEventAction(event);
    expect(result).toContain("page.goto('https://example.com')");
  });
});
