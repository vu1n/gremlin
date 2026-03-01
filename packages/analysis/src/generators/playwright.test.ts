import { describe, test, expect } from 'bun:test';
import { generatePlaywrightTests } from './playwright.ts';
import type { GremlinSpec } from '../spec/types.ts';
import { stateId, createSpec, createState, createTransition } from '../spec/types.ts';

function makeSpec(overrides?: Partial<GremlinSpec>): GremlinSpec {
  const spec = createSpec('TestApp', 'web');
  spec.metadata.sessionCount = 5;

  const home = createState('home', 'Home');
  home.observedCount = 10;
  home.metadata = { url: 'http://localhost:3000/' };

  const login = createState('login', 'Login');
  login.observedCount = 8;
  login.invariants = [
    { type: 'element_visible', element: { testId: 'login-form' } },
  ];

  const dashboard = createState('dashboard', 'Dashboard');
  dashboard.observedCount = 6;
  dashboard.metadata = {
    identifyingElement: { testId: 'dashboard-header' },
  };

  spec.states = [home, login, dashboard];
  spec.initialState = stateId('home');

  spec.transitions = [
    {
      ...createTransition('t1', stateId('home'), stateId('login'), {
        type: 'tap',
        element: { testId: 'login-btn', type: 'button', text: 'Log In' },
      }),
      frequency: 10,
    },
    {
      ...createTransition('t2', stateId('login'), stateId('dashboard'), {
        type: 'submit',
        element: { testId: 'submit-btn' },
      }),
      frequency: 8,
    },
  ];

  return { ...spec, ...overrides };
}

describe('Playwright Generator', () => {
  test('generates valid test file with imports', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, { baseUrl: 'http://localhost:3000' });

    expect(code).toContain("import { test, expect } from '@playwright/test'");
    expect(code).toContain("test.describe('TestApp'");
    expect(code).toContain("await page.goto('http://localhost:3000')");
  });

  test('includes comment header with spec metadata', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      includeComments: true,
    });

    expect(code).toContain('Auto-generated Playwright tests from GremlinSpec: TestApp');
    expect(code).toContain('Sessions analyzed: 5');
  });

  test('omits comments when includeComments is false', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      includeComments: false,
    });

    expect(code).not.toContain('Auto-generated');
    expect(code).not.toContain('Sessions analyzed');
  });

  test('generates flow-based tests by default', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, { baseUrl: 'http://localhost:3000' });

    // Should have a flow test from Home to Dashboard (terminal state)
    expect(code).toContain('Home_to_Dashboard');
  });

  test('generates transition-based tests when groupBy is transition', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('Home_to_Login_via_tap');
    expect(code).toContain('Login_to_Dashboard_via_submit');
  });

  test('uses testId locator when available', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.getByTestId('login-btn')");
  });

  test('falls back to accessibilityLabel locator', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = {
      accessibilityLabel: 'Log in to your account',
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.getByLabel('Log in to your account')");
  });

  test('falls back to text-based locator with role', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = {
      text: 'Log In',
      type: 'button',
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.getByRole('button', { name: 'Log In' })");
  });

  test('falls back to text-based locator for links', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = {
      text: 'Learn More',
      type: 'link',
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.getByRole('link', { name: 'Learn More' })");
  });

  test('falls back to cssSelector locator', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = {
      cssSelector: '.btn-primary',
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.locator('.btn-primary')");
  });

  test('falls back to body locator when no element info', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = undefined;
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.locator('body')");
  });

  test('generates click action for tap event', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('.click()');
  });

  test('generates fill action for input event', () => {
    const spec = makeSpec();
    spec.transitions[0].event = {
      type: 'input',
      element: { testId: 'email-input' },
      data: { value: 'user@example.com' },
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("page.getByTestId('email-input')");
    expect(code).toContain(".fill('user@example.com')");
  });

  test('generates navigation action for navigation event', () => {
    const spec = makeSpec();
    spec.transitions[0].event = {
      type: 'navigation',
      data: { url: 'http://localhost:3000/about' },
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("await page.goto('http://localhost:3000/about')");
  });

  test('generates goBack action for back event', () => {
    const spec = makeSpec();
    spec.transitions[0].event = { type: 'back' };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('await page.goBack()');
  });

  test('generates scroll action for scroll event', () => {
    const spec = makeSpec();
    spec.transitions[0].event = {
      type: 'scroll',
      data: { deltaY: 300 },
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('await page.mouse.wheel(0, 300)');
  });

  test('generates dblclick action for double_tap event', () => {
    const spec = makeSpec();
    spec.transitions[0].event = {
      type: 'double_tap',
      element: { testId: 'item' },
    };
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('.dblclick()');
  });

  test('generates state assertion using identifyingElement metadata', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
    });

    // Dashboard has identifyingElement: { testId: 'dashboard-header' }
    expect(code).toContain("page.getByTestId('dashboard-header')");
    expect(code).toContain('toBeVisible()');
  });

  test('generates state assertion using element_visible invariants', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    // Login has invariant element_visible with testId: 'login-form'
    expect(code).toContain("page.getByTestId('login-form')");
  });

  test('generates visual regression screenshots when enabled', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      includeVisualTests: true,
    });

    expect(code).toContain('toHaveScreenshot');
  });

  test('does not include screenshots by default', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
    });

    expect(code).not.toContain('toHaveScreenshot');
  });

  test('sets custom timeout', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      timeout: 60000,
    });

    expect(code).toContain('test.setTimeout(60000)');
  });

  test('handles empty spec with no states or transitions', () => {
    const spec = createSpec('EmptyApp', 'web');
    spec.metadata.sessionCount = 0;
    const code = generatePlaywrightTests(spec, { baseUrl: 'http://localhost:3000' });

    expect(code).toContain("import { test, expect } from '@playwright/test'");
    expect(code).toContain("test.describe('EmptyApp'");
    // No test blocks since there are no flows
    expect(code).not.toContain('test(');
  });

  test('handles spec with single state and no transitions', () => {
    const spec = createSpec('SingleState', 'web');
    spec.metadata.sessionCount = 1;
    const home = createState('home', 'Home');
    home.observedCount = 1;
    spec.states = [home];
    spec.initialState = stateId('home');

    const code = generatePlaywrightTests(spec, { baseUrl: 'http://localhost:3000' });

    expect(code).toContain("test.describe('SingleState'");
    // No crash, generates the wrapper but no individual tests
    expect(code).not.toContain("test('");
  });

  test('generates helper functions', () => {
    const spec = makeSpec();
    const code = generatePlaywrightTests(spec, { baseUrl: 'http://localhost:3000' });

    expect(code).toContain('Helper Functions');
    expect(code).toContain('navigateToState');
    expect(code).toContain('waitForState');
  });

  test('generates guard assertions for transitions with guards in flow mode', () => {
    const spec = makeSpec();
    // Add guard to the first transition (home -> login)
    spec.transitions[0].guard = {
      type: 'element_visible',
      element: { testId: 'welcome-banner' },
    };

    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'flow',
    });

    expect(code).toContain("page.getByTestId('welcome-banner')");
    expect(code).toContain('toBeVisible()');
  });

  test('escapes special characters in strings', () => {
    const spec = makeSpec();
    spec.transitions[0].event = {
      type: 'input',
      element: { testId: 'name-input' },
      data: { value: "O'Brien" },
    };

    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain("O\\'Brien");
  });

  test('handles wildcard testIds', () => {
    const spec = makeSpec();
    spec.transitions[0].event.element = {
      testId: 'product-card-*',
    };

    const code = generatePlaywrightTests(spec, {
      baseUrl: 'http://localhost:3000',
      groupBy: 'transition',
    });

    expect(code).toContain('getByTestId(/product-card-.*/)');
    expect(code).toContain('.first()');
  });
});
