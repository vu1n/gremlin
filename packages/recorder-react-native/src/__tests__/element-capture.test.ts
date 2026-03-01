/**
 * React Native element capture tests
 *
 * Tests the element-capture module which extracts element information from
 * React Native component refs. Since we cannot run a real React Native
 * runtime in bun:test, we mock findNodeHandle and UIManager.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { RNComponentRef } from '../element-capture.ts';
import type { ExtractedElementInfo } from '../types.ts';

// ---------------------------------------------------------------------------
// Mock React Native APIs
// ---------------------------------------------------------------------------

// We need to mock 'react-native' before importing element-capture.
// Bun supports module mocking via mock.module.

let mockFindNodeHandle: (target: unknown) => number | null;
let mockUIManagerMeasure: (
  handle: number,
  callback: (x: number, y: number, w: number, h: number, px: number, py: number) => void,
) => void;

mock.module('react-native', () => ({
  findNodeHandle: (target: unknown) => mockFindNodeHandle(target),
  UIManager: {
    measure: (
      handle: number,
      callback: (x: number, y: number, w: number, h: number, px: number, py: number) => void,
    ) => mockUIManagerMeasure(handle, callback),
  },
}));

// Now import the module under test (after mocks are set up)
const {
  captureElement,
  measureElement,
  findInteractiveParent,
  toElementInfo,
} = await import('../element-capture.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRef(overrides: Partial<RNComponentRef> = {}): RNComponentRef {
  return {
    props: {},
    type: undefined,
    constructor: undefined,
    _fiber: undefined,
    _owner: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Default: findNodeHandle returns a valid handle, UIManager.measure succeeds
  mockFindNodeHandle = () => 42;
  mockUIManagerMeasure = (_handle, callback) => {
    callback(0, 0, 100, 50, 10, 20);
  };
});

// ---------------------------------------------------------------------------
// captureElement
// ---------------------------------------------------------------------------

describe('captureElement', () => {
  test('returns null for null target', async () => {
    const result = await captureElement(null);
    expect(result).toBeNull();
  });

  test('returns null for undefined target', async () => {
    const result = await captureElement(undefined);
    expect(result).toBeNull();
  });

  test('captures element type from displayName', async () => {
    const ref = makeRef({
      type: { displayName: 'TextInput', name: 'TextInput' },
      props: {},
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('input');
  });

  test('captures testID from props', async () => {
    const ref = makeRef({
      type: { displayName: 'View', name: 'View' },
      props: { testID: 'submit-button' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.testID).toBe('submit-button');
  });

  test('captures accessibilityLabel from props', async () => {
    const ref = makeRef({
      type: { displayName: 'Button', name: 'Button' },
      props: { accessibilityLabel: 'Submit form' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.accessibilityLabel).toBe('Submit form');
  });

  test('captures text content from string children', async () => {
    const ref = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      props: { children: 'Hello World' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello World');
  });

  test('captures text content from button title prop', async () => {
    const ref = makeRef({
      type: { displayName: 'Button', name: 'Button' },
      props: { title: 'Submit' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Submit');
  });

  test('captures text from TextInput value', async () => {
    const ref = makeRef({
      type: { displayName: 'TextInput', name: 'TextInput' },
      props: { value: 'user@example.com' },
    });

    const result = await captureElement(ref);

    expect(result!.text).toBe('user@example.com');
  });

  test('captures text from TextInput placeholder when no value', async () => {
    const ref = makeRef({
      type: { displayName: 'TextInput', name: 'TextInput' },
      props: { placeholder: 'Enter email...' },
    });

    const result = await captureElement(ref);

    expect(result!.text).toBe('Enter email...');
  });

  test('captures bounds from UIManager.measure', async () => {
    mockUIManagerMeasure = (_handle, cb) => {
      cb(5, 10, 200, 100, 50, 60);
    };

    const ref = makeRef({
      type: { displayName: 'View', name: 'View' },
      props: {},
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.bounds).toEqual({
      x: 50,
      y: 60,
      width: 200,
      height: 100,
    });
  });

  test('handles measure failure gracefully (no bounds)', async () => {
    mockFindNodeHandle = () => null;

    const ref = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      props: { children: 'test' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.bounds).toBeUndefined();
  });

  test('extracts text from array children (strings only)', async () => {
    const ref = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      props: { children: ['Hello', ' ', 'World'] },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello World');
  });
});

// ---------------------------------------------------------------------------
// measureElement — timeout / settling behavior
// ---------------------------------------------------------------------------

describe('measureElement', () => {
  test('resolves with measurement when UIManager.measure succeeds', async () => {
    mockUIManagerMeasure = (_handle, cb) => {
      cb(1, 2, 300, 150, 100, 200);
    };

    const ref = makeRef({ type: { displayName: 'View', name: 'View' } });
    const result = await measureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.pageX).toBe(100);
    expect(result!.pageY).toBe(200);
    expect(result!.width).toBe(300);
    expect(result!.height).toBe(150);
  });

  test('returns null when findNodeHandle returns null', async () => {
    mockFindNodeHandle = () => null;

    const ref = makeRef({ type: { displayName: 'View', name: 'View' } });
    const result = await measureElement(ref);

    expect(result).toBeNull();
  });

  test('returns null on timeout when measure callback never fires', async () => {
    mockUIManagerMeasure = () => {
      // Never call the callback — simulates an unmounted view
    };

    const ref = makeRef({ type: { displayName: 'View', name: 'View' } });
    const result = await measureElement(ref);

    // Should resolve to null after 500ms timeout
    expect(result).toBeNull();
  }, 2000);

  test('returns null when findNodeHandle throws', async () => {
    mockFindNodeHandle = () => {
      throw new Error('Component not mounted');
    };

    const ref = makeRef({ type: { displayName: 'View', name: 'View' } });
    const result = await measureElement(ref);

    expect(result).toBeNull();
  });

  test('only settles once even if measure callback fires multiple times', async () => {
    let callbackRef: ((x: number, y: number, w: number, h: number, px: number, py: number) => void) | null = null;
    mockUIManagerMeasure = (_handle, cb) => {
      callbackRef = cb;
      cb(0, 0, 100, 50, 10, 20);
    };

    const ref = makeRef({ type: { displayName: 'View', name: 'View' } });
    const result = await measureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.width).toBe(100);

    // Second call should be ignored (settled = true)
    expect(callbackRef).not.toBeNull();
    callbackRef!(0, 0, 999, 999, 999, 999);
    // No way to observe the duplicate since the promise already resolved,
    // but this verifies no errors are thrown
  });
});

// ---------------------------------------------------------------------------
// findInteractiveParent
// ---------------------------------------------------------------------------

describe('findInteractiveParent', () => {
  test('returns null for null target', () => {
    const result = findInteractiveParent(null);
    expect(result).toBeNull();
  });

  test('returns null for undefined target', () => {
    const result = findInteractiveParent(undefined);
    expect(result).toBeNull();
  });

  test('returns the target itself when it is a button', () => {
    const button = makeRef({
      type: { displayName: 'Button', name: 'Button' },
      props: { role: 'button' },
    });

    const result = findInteractiveParent(button);
    expect(result).toBe(button);
  });

  test('returns the target itself when it is a Pressable', () => {
    const pressable = makeRef({
      type: { displayName: 'Pressable', name: 'Pressable' },
    });

    const result = findInteractiveParent(pressable);
    expect(result).toBe(pressable);
  });

  test('returns the target itself when it is a TextInput', () => {
    const input = makeRef({
      type: { displayName: 'TextInput', name: 'TextInput' },
    });

    const result = findInteractiveParent(input);
    expect(result).toBe(input);
  });

  test('traverses _owner to find interactive parent', () => {
    const button = makeRef({
      type: { displayName: 'TouchableOpacity', name: 'TouchableOpacity' },
    });

    const text = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      _owner: button,
    });

    const result = findInteractiveParent(text);
    expect(result).toBe(button);
  });

  test('traverses return (fiber) when _owner is absent', () => {
    const pressable = makeRef({
      type: { displayName: 'Pressable', name: 'Pressable' },
    });

    const icon = makeRef({
      type: { displayName: 'Image', name: 'Image' },
      return: pressable,
    });

    const result = findInteractiveParent(icon);
    expect(result).toBe(pressable);
  });

  test('returns original target when no interactive parent found within maxDepth', () => {
    // Build a chain of non-interactive Views deeper than maxDepth (5)
    let current: RNComponentRef = makeRef({
      type: { displayName: 'View', name: 'View' },
    });

    for (let i = 0; i < 10; i++) {
      const parent = makeRef({
        type: { displayName: 'View', name: 'View' },
      });
      current._owner = parent;
      current = parent;
    }

    // Start from a leaf — should give back the original leaf
    const leaf = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      _owner: makeRef({
        type: { displayName: 'View', name: 'View' },
        _owner: makeRef({
          type: { displayName: 'View', name: 'View' },
          _owner: makeRef({
            type: { displayName: 'View', name: 'View' },
            _owner: makeRef({
              type: { displayName: 'View', name: 'View' },
              _owner: makeRef({
                type: { displayName: 'View', name: 'View' },
              }),
            }),
          }),
        }),
      }),
    });

    const result = findInteractiveParent(leaf);
    expect(result).toBe(leaf);
  });

  test('stops at correct depth and returns interactive element', () => {
    // Button at depth 3 (within maxDepth of 5)
    const button = makeRef({
      type: { displayName: 'Button', name: 'Button' },
      props: { role: 'button' },
    });

    const view2 = makeRef({
      type: { displayName: 'View', name: 'View' },
      _owner: button,
    });

    const view1 = makeRef({
      type: { displayName: 'View', name: 'View' },
      _owner: view2,
    });

    const text = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      _owner: view1,
    });

    const result = findInteractiveParent(text);
    expect(result).toBe(button);
  });

  test('recognizes TouchableHighlight as interactive', () => {
    const touchable = makeRef({
      type: { displayName: 'TouchableHighlight', name: 'TouchableHighlight' },
    });

    const result = findInteractiveParent(touchable);
    expect(result).toBe(touchable);
  });

  test('recognizes accessibilityRole button as interactive', () => {
    const customButton = makeRef({
      type: { displayName: 'CustomComponent', name: 'CustomComponent' },
      props: { accessibilityRole: 'button' },
    });

    const result = findInteractiveParent(customButton);
    expect(result).toBe(customButton);
  });
});

// ---------------------------------------------------------------------------
// toElementInfo — field normalization
// ---------------------------------------------------------------------------

describe('toElementInfo', () => {
  test('normalizes testID (capital D) to testId (lowercase d)', () => {
    const extracted: ExtractedElementInfo = {
      type: 'button',
      testID: 'my-button',
    };

    const result = toElementInfo(extracted);

    expect(result.testId).toBe('my-button');
    expect('testID' in result).toBe(false);
  });

  test('preserves accessibilityLabel', () => {
    const extracted: ExtractedElementInfo = {
      type: 'button',
      accessibilityLabel: 'Submit form',
    };

    const result = toElementInfo(extracted);

    expect(result.accessibilityLabel).toBe('Submit form');
  });

  test('preserves text field', () => {
    const extracted: ExtractedElementInfo = {
      type: 'text',
      text: 'Hello World',
    };

    const result = toElementInfo(extracted);

    expect(result.text).toBe('Hello World');
  });

  test('preserves element type', () => {
    const extracted: ExtractedElementInfo = {
      type: 'input',
    };

    const result = toElementInfo(extracted);

    expect(result.type).toBe('input');
  });

  test('omits bounds from output (return type is Omit<ElementInfo, "bounds">)', () => {
    const extracted: ExtractedElementInfo = {
      type: 'container',
      bounds: { x: 10, y: 20, width: 100, height: 50 },
    };

    const result = toElementInfo(extracted);

    expect('bounds' in result).toBe(false);
  });

  test('handles minimal input with only type', () => {
    const extracted: ExtractedElementInfo = {
      type: 'unknown',
    };

    const result = toElementInfo(extracted);

    expect(result.type).toBe('unknown');
    expect(result.testId).toBeUndefined();
    expect(result.accessibilityLabel).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  test('handles all fields populated', () => {
    const extracted: ExtractedElementInfo = {
      type: 'button',
      testID: 'btn-submit',
      accessibilityLabel: 'Submit the form',
      text: 'Submit',
      bounds: { x: 0, y: 0, width: 200, height: 48 },
    };

    const result = toElementInfo(extracted);

    expect(result.type).toBe('button');
    expect(result.testId).toBe('btn-submit');
    expect(result.accessibilityLabel).toBe('Submit the form');
    expect(result.text).toBe('Submit');
    expect('bounds' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fallback paths when RN APIs are unavailable
// ---------------------------------------------------------------------------

describe('fallback paths', () => {
  test('captureElement succeeds even when findNodeHandle returns null', async () => {
    mockFindNodeHandle = () => null;

    const ref = makeRef({
      type: { displayName: 'Button', name: 'Button' },
      props: { title: 'Click me', testID: 'btn' },
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('button');
    expect(result!.testID).toBe('btn');
    expect(result!.text).toBe('Click me');
    // No bounds since findNodeHandle returned null
    expect(result!.bounds).toBeUndefined();
  });

  test('captureElement succeeds when UIManager.measure throws', async () => {
    mockUIManagerMeasure = () => {
      throw new Error('UIManager not available');
    };

    const ref = makeRef({
      type: { displayName: 'Text', name: 'Text' },
      props: { children: 'fallback test' },
    });

    const result = await captureElement(ref);

    // Should still capture element info without bounds
    expect(result).not.toBeNull();
    expect(result!.type).toBe('text');
    expect(result!.text).toBe('fallback test');
    expect(result!.bounds).toBeUndefined();
  });

  test('detectElementType falls back to unknown for unrecognized components', async () => {
    const ref = makeRef({
      type: { displayName: 'MyCustomWidget', name: 'MyCustomWidget' },
      props: {},
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('unknown');
  });

  test('getComponentName falls back through constructor.name', async () => {
    const ref = makeRef({
      type: undefined,
      constructor: { name: 'ScrollView' },
      props: {},
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('scroll_view');
  });

  test('getComponentName falls back through _fiber.type.name', async () => {
    const ref = makeRef({
      type: undefined,
      constructor: undefined,
      _fiber: { type: { name: 'FlatList' } },
      props: {},
    });

    const result = await captureElement(ref);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('list');
  });
});

// ---------------------------------------------------------------------------
// Element type detection coverage
// ---------------------------------------------------------------------------

describe('detectElementType coverage', () => {
  const typeTestCases: [string, string][] = [
    ['Button', 'button'],
    ['Pressable', 'pressable'],
    ['TouchableOpacity', 'pressable'],
    ['TouchableHighlight', 'pressable'],
    ['TouchableWithoutFeedback', 'pressable'],
    ['TouchableNativeFeedback', 'pressable'],
    ['TextInput', 'input'],
    ['Text', 'text'],
    ['Image', 'image'],
    ['ImageBackground', 'image'],
    ['ScrollView', 'scroll_view'],
    ['FlatList', 'list'],
    ['SectionList', 'list'],
    ['VirtualizedList', 'list'],
    ['Modal', 'modal'],
    ['View', 'container'],
    ['SafeAreaView', 'container'],
    ['RandomComponent', 'unknown'],
  ];

  for (const [componentName, expectedType] of typeTestCases) {
    test(`${componentName} -> ${expectedType}`, async () => {
      const ref = makeRef({
        type: { displayName: componentName, name: componentName },
        props: {},
      });

      const result = await captureElement(ref);

      expect(result).not.toBeNull();
      expect(result!.type).toBe(expectedType);
    });
  }

  test('role=button override produces button type', async () => {
    const ref = makeRef({
      type: { displayName: 'View', name: 'View' },
      props: { role: 'button' },
    });

    const result = await captureElement(ref);

    expect(result!.type).toBe('button');
  });

  test('accessibilityRole=button override produces button type', async () => {
    const ref = makeRef({
      type: { displayName: 'View', name: 'View' },
      props: { accessibilityRole: 'button' },
    });

    const result = await captureElement(ref);

    expect(result!.type).toBe('button');
  });
});
