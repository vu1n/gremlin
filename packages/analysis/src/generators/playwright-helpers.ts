/**
 * Shared Playwright Code Generation Helpers
 *
 * Common helpers used by both the Playwright test generator and the fuzz test generator
 * for generating Playwright-compatible locators and actions.
 */

import type { TransitionEvent, ElementRef } from '../spec/types.ts';
import { escapeString } from './utils.ts';

export function generateLocator(element?: ElementRef): string {
  if (!element) {
    return `page.locator('body')`;
  }

  // Priority order for selectors
  if (element.testId) {
    if (element.testId.includes('*')) {
      const regexPattern = element.testId
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      return `page.getByTestId(/${regexPattern}/).first()`;
    }
    return `page.getByTestId('${element.testId}')`;
  }

  if (element.accessibilityLabel) {
    return `page.getByLabel('${escapeString(element.accessibilityLabel)}')`;
  }

  if (element.text) {
    // Use role if we know the element type
    if (element.type === 'button') {
      return `page.getByRole('button', { name: '${escapeString(element.text)}' })`;
    }
    if (element.type === 'link') {
      return `page.getByRole('link', { name: '${escapeString(element.text)}' })`;
    }
    return `page.getByText('${escapeString(element.text)}')`;
  }

  if (element.cssSelector) {
    return `page.locator('${element.cssSelector}')`;
  }

  if (element.coordinates) {
    return `page.locator('body')`;
  }

  return `page.locator('body')`;
}

export function generateEventAction(event: TransitionEvent): string {
  const element = event.element;
  const eventType = event.type.toLowerCase();

  switch (eventType) {
    case 'tap':
      return generateClickAction(element);

    case 'double_tap':
      return generateDblClickAction(element);

    case 'input':
      return generateInputAction(element, event.data);

    case 'submit':
      return generateSubmitAction(element);

    case 'scroll':
      return generateScrollAction(event.data);

    case 'navigation':
    case 'navigate':
      return generateNavigationAction(event.data);

    case 'back':
      return `await page.goBack();`;

    default:
      return `await page.waitForLoadState('networkidle'); // Unhandled event: ${event.type}`;
  }
}

function generateClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.click();`;
}

function generateDblClickAction(element?: ElementRef): string {
  const locator = generateLocator(element);
  return `await ${locator}.dblclick();`;
}

function generateInputAction(element?: ElementRef, data?: Record<string, unknown>): string {
  const locator = generateLocator(element);
  const value = typeof data?.value === 'string' ? data.value : 'test input';
  return `await ${locator}.fill('${escapeString(value)}');`;
}

function generateSubmitAction(element?: ElementRef): string {
  if (element) {
    const locator = generateLocator(element);
    return `await ${locator}.press('Enter');`;
  }
  return `await page.keyboard.press('Enter');`;
}

function generateScrollAction(data?: Record<string, unknown>): string {
  const deltaY = typeof data?.deltaY === 'number' ? data.deltaY : 500;
  return `await page.mouse.wheel(0, ${deltaY});`;
}

function generateNavigationAction(data?: Record<string, unknown>): string {
  if (typeof data?.url === 'string') {
    return `await page.goto('${escapeString(data.url)}');`;
  }
  if (typeof data?.path === 'string') {
    return `await page.goto('${escapeString(data.path)}');`;
  }
  if (typeof data?.screen === 'string') {
    return `await page.waitForURL(/${escapeString(data.screen)}/);`;
  }
  return `await page.waitForLoadState('networkidle');`;
}
