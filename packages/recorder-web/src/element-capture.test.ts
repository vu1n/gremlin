import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import type { ElementInfo } from '@gremlin/session';

// We need real class hierarchies so `instanceof` checks in element-capture work.

class MockHTMLElement {
  tagName: string;
  id: string;
  textContent: string | null;
  children: any[];
  style: Record<string, string>;
  onclick: (() => void) | null;
  parentElement: MockHTMLElement | null;

  private _attrs: Record<string, string>;
  private _classList: string[];
  private _boundingRect: { x: number; y: number; width: number; height: number };

  constructor(tag: string, opts: {
    id?: string;
    classList?: string[];
    textContent?: string | null;
    children?: any[];
    attributes?: Record<string, string>;
    style?: Record<string, string>;
    onclick?: (() => void) | null;
    parentElement?: MockHTMLElement | null;
    boundingRect?: { x: number; y: number; width: number; height: number };
  } = {}) {
    this.tagName = tag.toUpperCase();
    this.id = opts.id ?? '';
    this.textContent = opts.textContent ?? null;
    this.children = opts.children ?? [];
    this.style = opts.style ?? {};
    this.onclick = opts.onclick ?? null;
    this.parentElement = opts.parentElement ?? null;
    this._attrs = {};
    if (opts.id) this._attrs.id = opts.id;
    if (opts.attributes) Object.assign(this._attrs, opts.attributes);
    this._classList = opts.classList ?? [];
    this._boundingRect = opts.boundingRect ?? { x: 0, y: 0, width: 100, height: 30 };
  }

  getAttribute(name: string): string | null {
    if (name === 'onclick' && this.onclick) return 'true';
    return this._attrs[name] ?? null;
  }

  getBoundingClientRect() {
    return { ...this._boundingRect };
  }

  get classList() {
    const list = this._classList;
    return {
      length: list.length,
      [Symbol.iterator]() { return list[Symbol.iterator](); },
    };
  }
}

class MockHTMLImageElement extends MockHTMLElement {
  alt: string;
  constructor(opts: any = {}) {
    super('img', opts);
    this.alt = opts.alt ?? '';
  }
}

class MockHTMLInputElement extends MockHTMLElement {
  type: string;
  name: string;
  value: string;
  constructor(opts: any = {}) {
    super('input', opts);
    this.type = opts.type ?? 'text';
    this.name = opts.name ?? '';
    this.value = opts.value ?? '';
  }
}

class MockHTMLTextAreaElement extends MockHTMLElement {
  constructor(opts: any = {}) {
    super('textarea', opts);
  }
}

class MockHTMLButtonElement extends MockHTMLElement {
  type: string;
  name: string;
  constructor(opts: any = {}) {
    super('button', opts);
    this.type = opts.type ?? 'submit';
    this.name = opts.name ?? '';
  }
}

class MockHTMLAnchorElement extends MockHTMLElement {
  href: string;
  constructor(opts: any = {}) {
    super('a', opts);
    this.href = opts.href ?? '';
  }
}

class MockHTMLSelectElement extends MockHTMLElement {
  constructor(opts: any = {}) {
    super('select', opts);
  }
}

const savedGlobals: Record<string, any> = {};

beforeAll(() => {
  // Save originals
  for (const name of [
    'HTMLElement', 'HTMLImageElement', 'HTMLInputElement', 'HTMLTextAreaElement',
    'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLSelectElement',
    'document', 'CSS',
  ]) {
    savedGlobals[name] = (globalThis as any)[name];
  }

  // Install mock classes
  (globalThis as any).HTMLElement = MockHTMLElement;
  (globalThis as any).HTMLImageElement = MockHTMLImageElement;
  (globalThis as any).HTMLInputElement = MockHTMLInputElement;
  (globalThis as any).HTMLTextAreaElement = MockHTMLTextAreaElement;
  (globalThis as any).HTMLButtonElement = MockHTMLButtonElement;
  (globalThis as any).HTMLAnchorElement = MockHTMLAnchorElement;
  (globalThis as any).HTMLSelectElement = MockHTMLSelectElement;

  // Mock document for querySelector and getElementById and body
  (globalThis as any).document = {
    body: new MockHTMLElement('body'),
    getElementById: () => null,
    querySelector: () => null,
  };

  // Mock CSS.escape
  (globalThis as any).CSS = { escape: (s: string) => s };
});

afterAll(() => {
  for (const [name, val] of Object.entries(savedGlobals)) {
    (globalThis as any)[name] = val;
  }
});

// Dynamic import to ensure our globals are set first
let captureElement: typeof import('./element-capture').captureElement;
let findInteractiveElement: typeof import('./element-capture').findInteractiveElement;

beforeAll(async () => {
  const mod = await import('./element-capture');
  captureElement = mod.captureElement;
  findInteractiveElement = mod.findInteractiveElement;
});

/** Shorthand to create a basic MockHTMLElement and captureElement it. */
function capture(tag: string, opts: ConstructorParameters<typeof MockHTMLElement>[1] = {}): ElementInfo {
  const el = new MockHTMLElement(tag, opts);
  return captureElement(el as any);
}

describe('captureElement', () => {
  // --------------------------------------------------------------------------
  // testId extraction
  // --------------------------------------------------------------------------

  describe('testId extraction', () => {
    test('captures data-testid attribute', () => {
      const info = capture('button', { attributes: { 'data-testid': 'submit-btn' }, textContent: 'Submit' });
      expect(info.testId).toBe('submit-btn');
    });

    test('captures data-test-id attribute', () => {
      const info = capture('button', { attributes: { 'data-test-id': 'cancel-btn' }, textContent: 'Cancel' });
      expect(info.testId).toBe('cancel-btn');
    });

    test('captures data-test attribute', () => {
      const info = capture('div', { attributes: { 'data-test': 'my-card' }, textContent: 'Card' });
      expect(info.testId).toBe('my-card');
    });

    test('captures testid attribute', () => {
      const info = capture('span', { attributes: { testid: 'label-1' }, textContent: 'Label' });
      expect(info.testId).toBe('label-1');
    });

    test('captures test-id attribute', () => {
      const info = capture('div', { attributes: { 'test-id': 'wrapper' }, textContent: 'Hello' });
      expect(info.testId).toBe('wrapper');
    });

    test('returns undefined when no test id present', () => {
      const info = capture('div', { textContent: 'Plain' });
      expect(info.testId).toBeUndefined();
    });

    test('prefers data-testid over other variants', () => {
      const info = capture('button', {
        attributes: { 'data-testid': 'primary', 'data-test': 'secondary' },
        textContent: 'Click',
      });
      expect(info.testId).toBe('primary');
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility label extraction
  // --------------------------------------------------------------------------

  describe('accessibility label extraction', () => {
    test('captures aria-label', () => {
      const info = capture('button', { attributes: { 'aria-label': 'Close dialog' }, textContent: 'X' });
      expect(info.accessibilityLabel).toBe('Close dialog');
    });

    test('returns undefined when no accessibility label present', () => {
      const info = capture('div', { textContent: 'Plain' });
      expect(info.accessibilityLabel).toBeUndefined();
    });

    test('captures placeholder as fallback for input elements', () => {
      const el = new MockHTMLInputElement({ placeholder: 'Enter email', attributes: { placeholder: 'Enter email' } });
      const info = captureElement(el as any);
      expect(info.accessibilityLabel).toBe('Enter email');
    });
  });

  // --------------------------------------------------------------------------
  // Text extraction
  // --------------------------------------------------------------------------

  describe('text extraction', () => {
    test('captures text content from element', () => {
      const info = capture('button', { textContent: 'Click Me', children: [] });
      expect(info.text).toBe('Click Me');
    });

    test('trims whitespace from text', () => {
      const info = capture('span', { textContent: '  Hello World  ', children: [] });
      expect(info.text).toBe('Hello World');
    });

    test('normalizes internal whitespace', () => {
      const info = capture('p', { textContent: 'Hello    World\n\nFoo', children: [] });
      expect(info.text).toBe('Hello World Foo');
    });

    test('truncates text longer than 100 chars', () => {
      const longText = 'A'.repeat(150);
      const info = capture('p', { textContent: longText, children: [] });
      expect(info.text).toBe('A'.repeat(100) + '...');
    });

    test('returns undefined for empty text', () => {
      const info = capture('div', { textContent: '', children: [] });
      expect(info.text).toBeUndefined();
    });

    test('returns undefined for whitespace-only text', () => {
      const info = capture('div', { textContent: '   ', children: [] });
      expect(info.text).toBeUndefined();
    });

    test('returns undefined for elements with more than 3 children (containers)', () => {
      const info = capture('div', { textContent: 'Some text', children: [{}, {}, {}, {}] });
      expect(info.text).toBeUndefined();
    });

    test('returns undefined for null textContent', () => {
      const info = capture('div', { textContent: null, children: [] });
      expect(info.text).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Element type inference
  // --------------------------------------------------------------------------

  describe('element type inference', () => {
    test('button tag returns button type', () => {
      expect(capture('button', { textContent: 'Click' }).type).toBe('button');
    });

    test('a tag returns link type', () => {
      expect(capture('a', { textContent: 'Home' }).type).toBe('link');
    });

    test('input tag returns input type', () => {
      expect(capture('input', { textContent: '', children: [] }).type).toBe('input');
    });

    test('textarea tag returns input type', () => {
      expect(capture('textarea', { textContent: '', children: [] }).type).toBe('input');
    });

    test('select tag returns input type', () => {
      expect(capture('select', { textContent: '', children: [] }).type).toBe('input');
    });

    test('img tag returns image type', () => {
      expect(capture('img', { textContent: '', children: [] }).type).toBe('image');
    });

    test('svg tag returns image type', () => {
      expect(capture('svg', { textContent: '', children: [] }).type).toBe('image');
    });

    test('ul tag returns list type', () => {
      expect(capture('ul', { textContent: '', children: [] }).type).toBe('list');
    });

    test('ol tag returns list type', () => {
      expect(capture('ol', { textContent: '', children: [] }).type).toBe('list');
    });

    test('li tag returns list_item type', () => {
      expect(capture('li', { textContent: 'Item', children: [] }).type).toBe('list_item');
    });

    test('p tag returns text type', () => {
      expect(capture('p', { textContent: 'Paragraph', children: [] }).type).toBe('text');
    });

    test('h1-h6 tags return text type', () => {
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(capture(tag, { textContent: 'Heading', children: [] }).type).toBe('text');
      }
    });

    test('span tag returns text type', () => {
      expect(capture('span', { textContent: 'Text', children: [] }).type).toBe('text');
    });

    test('label tag returns text type', () => {
      expect(capture('label', { textContent: 'Name:', children: [] }).type).toBe('text');
    });

    test('div tag returns container type', () => {
      expect(capture('div', { textContent: '', children: [] }).type).toBe('container');
    });

    test('section/article/main/nav/header/footer/aside return container type', () => {
      for (const tag of ['section', 'article', 'main', 'nav', 'header', 'footer', 'aside']) {
        expect(capture(tag, { textContent: '', children: [] }).type).toBe('container');
      }
    });

    test('div with onclick handler returns touchable type', () => {
      expect(capture('div', { onclick: () => {}, textContent: '', children: [] }).type).toBe('touchable');
    });

    test('div with cursor:pointer style returns touchable type', () => {
      expect(capture('div', { style: { cursor: 'pointer' }, textContent: '', children: [] }).type).toBe('touchable');
    });

    test('div with onclick attribute returns touchable type', () => {
      // Our getAttribute mock returns 'true' when onclick handler is set.
      // But for the attribute check we need the attribute directly.
      const el = new MockHTMLElement('div', {
        attributes: { onclick: 'doSomething()' },
        textContent: '',
        children: [],
      });
      const info = captureElement(el as any);
      expect(info.type).toBe('touchable');
    });

    test('unknown tag returns unknown type', () => {
      expect(capture('custom-element', { textContent: '', children: [] }).type).toBe('unknown');
    });

    // Role-based inference
    test('role=button overrides tag-based inference', () => {
      expect(capture('div', { attributes: { role: 'button' }, textContent: 'Click', children: [] }).type).toBe('button');
    });

    test('role=link overrides tag-based inference', () => {
      expect(capture('span', { attributes: { role: 'link' }, textContent: 'Navigate', children: [] }).type).toBe('link');
    });

    test('role=textbox returns input type', () => {
      expect(capture('div', { attributes: { role: 'textbox' }, textContent: '', children: [] }).type).toBe('input');
    });

    test('role=searchbox returns input type', () => {
      expect(capture('div', { attributes: { role: 'searchbox' }, textContent: '', children: [] }).type).toBe('input');
    });

    test('role=dialog returns modal type', () => {
      expect(capture('div', { attributes: { role: 'dialog' }, textContent: '', children: [] }).type).toBe('modal');
    });

    test('role=alertdialog returns modal type', () => {
      expect(capture('div', { attributes: { role: 'alertdialog' }, textContent: '', children: [] }).type).toBe('modal');
    });

    test('role=list returns list type', () => {
      expect(capture('div', { attributes: { role: 'list' }, textContent: '', children: [] }).type).toBe('list');
    });

    test('role=listitem returns list_item type', () => {
      expect(capture('div', { attributes: { role: 'listitem' }, textContent: '', children: [] }).type).toBe('list_item');
    });

    test('role=img returns image type', () => {
      expect(capture('div', { attributes: { role: 'img' }, textContent: '', children: [] }).type).toBe('image');
    });

    test('role=image returns image type', () => {
      expect(capture('div', { attributes: { role: 'image' }, textContent: '', children: [] }).type).toBe('image');
    });
  });

  // --------------------------------------------------------------------------
  // Bounds measurement
  // --------------------------------------------------------------------------

  describe('bounds measurement', () => {
    test('captures and rounds bounding rect', () => {
      const info = capture('button', {
        textContent: 'OK',
        boundingRect: { x: 10.4, y: 20.7, width: 100.1, height: 40.9 },
      });
      expect(info.bounds).toEqual({ x: 10, y: 21, width: 100, height: 41 });
    });

    test('returns undefined bounds for zero-width elements', () => {
      const info = capture('div', {
        textContent: '',
        children: [],
        boundingRect: { x: 0, y: 0, width: 0, height: 30 },
      });
      expect(info.bounds).toBeUndefined();
    });

    test('returns undefined bounds for zero-height elements', () => {
      const info = capture('div', {
        textContent: '',
        children: [],
        boundingRect: { x: 0, y: 0, width: 100, height: 0 },
      });
      expect(info.bounds).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // CSS selector generation
  // --------------------------------------------------------------------------

  describe('CSS selector generation', () => {
    test('generates tag-based selector', () => {
      const info = capture('button', { textContent: 'OK', children: [] });
      expect(info.cssSelector).toBeDefined();
      expect(info.cssSelector).toContain('button');
    });

    test('generates id-based selector and stops', () => {
      const info = capture('div', { id: 'main-content', textContent: '', children: [] });
      expect(info.cssSelector).toContain('#main-content');
    });

    test('generates class-based selector', () => {
      const info = capture('div', { classList: ['card', 'highlighted'], textContent: '', children: [] });
      expect(info.cssSelector).toContain('.card');
      expect(info.cssSelector).toContain('.highlighted');
    });

    test('skips classes starting with underscore (generated)', () => {
      const info = capture('div', { classList: ['_generated', 'real-class'], textContent: '', children: [] });
      expect(info.cssSelector).toContain('.real-class');
      expect(info.cssSelector).not.toContain('._generated');
    });

    test('limits to 2 classes', () => {
      const info = capture('div', {
        classList: ['a', 'b', 'c', 'd'],
        textContent: '',
        children: [],
      });
      // Should have at most 2 class selectors
      const classMatches = info.cssSelector?.match(/\./g) ?? [];
      expect(classMatches.length).toBeLessThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // Attributes extraction
  // --------------------------------------------------------------------------

  describe('attributes extraction', () => {
    test('captures type and name for HTMLInputElement', () => {
      const el = new MockHTMLInputElement({ type: 'email', name: 'user-email' });
      const info = captureElement(el as any);
      expect(info.attributes?.type).toBe('email');
      expect(info.attributes?.name).toBe('user-email');
    });

    test('captures type and name for HTMLButtonElement', () => {
      const el = new MockHTMLButtonElement({ type: 'submit', name: 'save-btn', textContent: 'Save' });
      const info = captureElement(el as any);
      expect(info.attributes?.type).toBe('submit');
      expect(info.attributes?.name).toBe('save-btn');
    });

    test('captures href for HTMLAnchorElement', () => {
      const el = new MockHTMLAnchorElement({ href: 'https://example.com/page', textContent: 'Link' });
      const info = captureElement(el as any);
      expect(info.attributes?.href).toBe('https://example.com/page');
    });

    test('does not capture javascript: href for HTMLAnchorElement', () => {
      const el = new MockHTMLAnchorElement({ href: 'javascript:void(0)', textContent: 'Link' });
      const info = captureElement(el as any);
      expect(info.attributes?.href).toBeUndefined();
    });

    test('captures name attribute from generic element', () => {
      const info = capture('div', { attributes: { name: 'my-div' }, textContent: '', children: [] });
      expect(info.attributes?.name).toBe('my-div');
    });

    test('captures title attribute', () => {
      const info = capture('span', { attributes: { title: 'Tooltip' }, textContent: 'Hover me', children: [] });
      expect(info.attributes?.title).toBe('Tooltip');
    });

    test('returns undefined attributes when none are relevant', () => {
      const info = capture('div', { textContent: 'Plain', children: [] });
      expect(info.attributes).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Element with no identifiers
  // --------------------------------------------------------------------------

  describe('element with no identifiers', () => {
    test('captures element with minimal info', () => {
      const info = capture('div', {
        textContent: '',
        children: [],
        boundingRect: { x: 0, y: 0, width: 0, height: 0 },
      });
      expect(info.testId).toBeUndefined();
      expect(info.accessibilityLabel).toBeUndefined();
      expect(info.text).toBeUndefined();
      expect(info.type).toBe('container');
      expect(info.bounds).toBeUndefined();
    });
  });
});

describe('findInteractiveElement', () => {
  test('returns null for null target', () => {
    expect(findInteractiveElement(null)).toBeNull();
  });

  test('returns null for non-HTMLElement target', () => {
    expect(findInteractiveElement({} as EventTarget)).toBeNull();
  });

  test('returns button element directly', () => {
    const btn = new MockHTMLElement('button', { textContent: 'Click' });
    const result = findInteractiveElement(btn as any);
    expect(result).toBe(btn as any);
  });

  test('returns anchor element directly', () => {
    const link = new MockHTMLAnchorElement({ textContent: 'Link', href: '/page' });
    const result = findInteractiveElement(link as any);
    expect(result).toBe(link as any);
  });

  test('returns input element directly', () => {
    const input = new MockHTMLInputElement({ type: 'text' });
    const result = findInteractiveElement(input as any);
    expect(result).toBe(input as any);
  });

  test('walks up to find interactive parent', () => {
    const btn = new MockHTMLElement('button', { textContent: 'Click' });
    const span = new MockHTMLElement('span', { textContent: 'Icon', parentElement: btn });
    const result = findInteractiveElement(span as any);
    expect(result).toBe(btn as any);
  });

  test('returns element with role=button', () => {
    const el = new MockHTMLElement('div', { attributes: { role: 'button' }, textContent: 'Click' });
    const result = findInteractiveElement(el as any);
    expect(result).toBe(el as any);
  });

  test('returns element with onclick handler', () => {
    const el = new MockHTMLElement('div', { onclick: () => {}, textContent: 'Click' });
    const result = findInteractiveElement(el as any);
    expect(result).toBe(el as any);
  });

  test('returns element with cursor:pointer', () => {
    const el = new MockHTMLElement('div', { style: { cursor: 'pointer' }, textContent: 'Click' });
    const result = findInteractiveElement(el as any);
    expect(result).toBe(el as any);
  });

  test('returns element with data-testid (likely interactive)', () => {
    const el = new MockHTMLElement('div', { attributes: { 'data-testid': 'card' }, textContent: 'Card' });
    const result = findInteractiveElement(el as any);
    expect(result).toBe(el as any);
  });

  test('returns null if no interactive element within 5 levels', () => {
    // Build a chain of 6 plain divs
    let current: MockHTMLElement | null = null;
    for (let i = 0; i < 6; i++) {
      current = new MockHTMLElement('div', { textContent: '', parentElement: current });
    }
    const result = findInteractiveElement(current as any);
    expect(result).toBeNull();
  });

  test('finds interactive element within maxDepth', () => {
    const btn = new MockHTMLElement('button', { textContent: 'Click' });
    let current: MockHTMLElement = btn;
    // 4 levels deep (within max of 5)
    for (let i = 0; i < 4; i++) {
      const child = new MockHTMLElement('span', { textContent: '', parentElement: current });
      current = child;
    }
    const result = findInteractiveElement(current as any);
    expect(result).toBe(btn as any);
  });
});
