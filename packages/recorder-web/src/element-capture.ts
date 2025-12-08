/**
 * Element capture - Extract identification info from DOM elements
 *
 * Priority order for element identification:
 * 1. data-testid (best for test generation)
 * 2. aria-label (accessibility)
 * 3. text content
 * 4. CSS selector (fallback)
 */

import type { ElementInfo, Rect } from '@gremlin/session';

// Import ElementType specifically from session types to avoid ambiguity
type ElementType =
  | 'button'
  | 'link'
  | 'input'
  | 'text'
  | 'image'
  | 'container'
  | 'scroll_view'
  | 'list'
  | 'list_item'
  | 'modal'
  | 'pressable'
  | 'touchable'
  | 'unknown';

/**
 * Capture element information for the dictionary.
 * Extracts test IDs, accessibility labels, and generates fallback selectors.
 */
export function captureElement(element: HTMLElement): ElementInfo {
  const testId = extractTestId(element);
  const accessibilityLabel = extractAccessibilityLabel(element);
  const text = extractText(element);
  const type = inferElementType(element);
  const bounds = getBoundingRect(element);
  const cssSelector = generateCssSelector(element);
  const attributes = extractRelevantAttributes(element);

  return {
    testId,
    accessibilityLabel,
    text,
    type,
    bounds,
    cssSelector,
    attributes,
  };
}

/**
 * Extract test ID from element.
 * Checks common test ID attributes.
 */
function extractTestId(element: HTMLElement): string | undefined {
  // Check common test ID attributes
  const testId =
    element.getAttribute('data-testid') ||
    element.getAttribute('data-test-id') ||
    element.getAttribute('data-test') ||
    element.getAttribute('testid') ||
    element.getAttribute('test-id');

  return testId || undefined;
}

/**
 * Extract accessibility label.
 * Checks aria-label, aria-labelledby, and alt text.
 */
function extractAccessibilityLabel(element: HTMLElement): string | undefined {
  // Direct aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby reference
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement?.textContent) {
      return labelElement.textContent.trim();
    }
  }

  // Image alt text
  if (element instanceof HTMLImageElement && element.alt) {
    return element.alt;
  }

  // Input label
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const id = element.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label?.textContent) {
        return label.textContent.trim();
      }
    }

    // Placeholder as fallback
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder;
  }

  return undefined;
}

/**
 * Extract visible text content.
 * Truncates long text and normalizes whitespace.
 */
function extractText(element: HTMLElement): string | undefined {
  // Skip if no visible text
  if (element.children.length > 3) {
    // Too many children, likely a container
    return undefined;
  }

  const text = element.textContent?.trim();
  if (!text || text.length === 0) return undefined;

  // Truncate long text
  const maxLength = 100;
  if (text.length > maxLength) {
    return text.substring(0, maxLength) + '...';
  }

  // Normalize whitespace
  return text.replace(/\s+/g, ' ');
}

/**
 * Infer element type from tag name and attributes.
 */
function inferElementType(element: HTMLElement): ElementType {
  const tagName = element.tagName.toLowerCase();
  const role = element.getAttribute('role');

  // Check role first
  if (role) {
    switch (role) {
      case 'button':
        return 'button';
      case 'link':
        return 'link';
      case 'textbox':
      case 'searchbox':
        return 'input';
      case 'img':
      case 'image':
        return 'image';
      case 'list':
        return 'list';
      case 'listitem':
        return 'list_item';
      case 'dialog':
      case 'alertdialog':
        return 'modal';
    }
  }

  // Check tag name
  switch (tagName) {
    case 'button':
      return 'button';
    case 'a':
      return 'link';
    case 'input':
    case 'textarea':
    case 'select':
      return 'input';
    case 'img':
    case 'svg':
      return 'image';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'list_item';
    case 'p':
    case 'span':
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
    case 'label':
      return 'text';
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'aside':
    case 'nav':
    case 'header':
    case 'footer':
      // Check if clickable
      if (
        element.onclick ||
        element.getAttribute('onclick') ||
        element.style.cursor === 'pointer'
      ) {
        return 'touchable';
      }
      return 'container';
    default:
      return 'unknown';
  }
}

/**
 * Get bounding rectangle of element.
 */
function getBoundingRect(element: HTMLElement): Rect | undefined {
  try {
    const rect = element.getBoundingClientRect();

    // Skip elements with zero dimensions
    if (rect.width === 0 || rect.height === 0) {
      return undefined;
    }

    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  } catch {
    return undefined;
  }
}

/**
 * Generate CSS selector for element.
 * Creates a unique selector path from root.
 */
function generateCssSelector(element: HTMLElement): string | undefined {
  try {
    // Build selector from element to root
    const parts: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== document.body && parts.length < 5) {
      let selector = current.tagName.toLowerCase();

      // Add ID if present
      if (current.id) {
        selector += `#${CSS.escape(current.id)}`;
        parts.unshift(selector);
        break; // ID is unique, stop here
      }

      // Add classes (up to 2)
      const classes = Array.from(current.classList)
        .filter((c) => c && !c.startsWith('_')) // Skip generated classes
        .slice(0, 2)
        .map((c) => `.${CSS.escape(c)}`)
        .join('');
      selector += classes;

      // Add nth-child if needed for uniqueness
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current);
        const currentTag = current.tagName;
        if (siblings.filter((s) => s.tagName === currentTag).length > 1) {
          selector += `:nth-child(${index + 1})`;
        }
      }

      parts.unshift(selector);
      current = current.parentElement;
    }

    return parts.join(' > ') || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract relevant attributes for debugging.
 */
function extractRelevantAttributes(element: HTMLElement): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};

  // Input attributes
  if (element instanceof HTMLInputElement) {
    if (element.type) attrs.type = element.type;
    if (element.name) attrs.name = element.name;
  }

  // Button attributes
  if (element instanceof HTMLButtonElement) {
    if (element.type) attrs.type = element.type;
    if (element.name) attrs.name = element.name;
  }

  // Link attributes
  if (element instanceof HTMLAnchorElement) {
    if (element.href && !element.href.startsWith('javascript:')) {
      attrs.href = element.href;
    }
  }

  // Generic attributes
  const name = element.getAttribute('name');
  if (name) attrs.name = name;

  const title = element.getAttribute('title');
  if (title) attrs.title = title;

  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/**
 * Find the closest interactive element.
 * Walks up the DOM tree to find a clickable/interactive element.
 */
export function findInteractiveElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;

  let current: HTMLElement | null = target;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    // Check if interactive
    if (isInteractiveElement(current)) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }

  return null;
}

/**
 * Check if element is interactive.
 */
function isInteractiveElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();

  // Interactive tags
  if (['button', 'a', 'input', 'select', 'textarea'].includes(tagName)) {
    return true;
  }

  // Has click handler
  if (element.onclick || element.getAttribute('onclick')) {
    return true;
  }

  // Has role
  const role = element.getAttribute('role');
  if (role && ['button', 'link', 'textbox', 'searchbox', 'tab'].includes(role)) {
    return true;
  }

  // Has pointer cursor
  if (element.style.cursor === 'pointer') {
    return true;
  }

  // Has test ID (likely interactive)
  if (extractTestId(element)) {
    return true;
  }

  return false;
}
