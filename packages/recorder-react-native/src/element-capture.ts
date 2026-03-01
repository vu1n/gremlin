/**
 * Element Capture - Extract element information from React Native views
 *
 * Uses React Native's view hierarchy and accessibility APIs to identify elements.
 */

import type React from 'react';
import { findNodeHandle, UIManager } from 'react-native';
import type { ElementInfo, ElementType } from '@gremlin/session';
import type { ExtractedElementInfo, ViewMeasurement } from './types';

/**
 * Opaque React Native component instance.
 * We access React-internal fields (.props, .type, ._fiber, ._owner, .return)
 * which have no public type definitions. This interface captures the minimal
 * shape we actually read, keeping the rest of the code narrowed.
 */
export interface RNComponentRef {
  props?: Record<string, unknown>;
  type?: { displayName?: string; name?: string };
  constructor?: { name?: string };
  _fiber?: { type?: { name?: string } };
  _owner?: RNComponentRef;
  return?: RNComponentRef;
  [key: string]: unknown;
}

/**
 * Capture element information from a React Native component instance
 */
export async function captureElement(
  target: RNComponentRef | null | undefined
): Promise<ExtractedElementInfo | null> {
  if (!target) return null;

  try {
    const elementInfo: ExtractedElementInfo = {
      type: detectElementType(target),
    };

    // Extract testID (best for test generation)
    if (typeof target.props?.testID === 'string') {
      elementInfo.testID = target.props.testID;
    }

    // Extract accessibility label
    if (typeof target.props?.accessibilityLabel === 'string') {
      elementInfo.accessibilityLabel = target.props.accessibilityLabel;
    }

    // Extract text content
    const text = extractTextContent(target);
    if (text) {
      elementInfo.text = text;
    }

    // Get bounds
    const bounds = await measureElement(target);
    if (bounds) {
      elementInfo.bounds = {
        x: bounds.pageX,
        y: bounds.pageY,
        width: bounds.width,
        height: bounds.height,
      };
    }

    return elementInfo;
  } catch (error) {
    console.warn('Failed to capture element:', error);
    return null;
  }
}

/**
 * Detect element type from component props and type
 */
function detectElementType(target: RNComponentRef): ElementType {
  if (!target) return 'unknown';

  const componentName = getComponentName(target);

  // Button types
  if (
    componentName === 'Button' ||
    target.props?.role === 'button' ||
    target.props?.accessibilityRole === 'button'
  ) {
    return 'button';
  }

  // Pressable/Touchable types
  if (
    componentName === 'Pressable' ||
    componentName === 'TouchableOpacity' ||
    componentName === 'TouchableHighlight' ||
    componentName === 'TouchableWithoutFeedback' ||
    componentName === 'TouchableNativeFeedback'
  ) {
    return 'pressable';
  }

  // Input types
  if (componentName === 'TextInput') {
    return 'input';
  }

  // Text types
  if (componentName === 'Text') {
    return 'text';
  }

  // Image types
  if (componentName === 'Image' || componentName === 'ImageBackground') {
    return 'image';
  }

  // ScrollView types
  if (componentName === 'ScrollView') {
    return 'scroll_view';
  }

  // List types
  if (
    componentName === 'FlatList' ||
    componentName === 'SectionList' ||
    componentName === 'VirtualizedList'
  ) {
    return 'list';
  }

  // Modal types
  if (componentName === 'Modal') {
    return 'modal';
  }

  // View/Container types
  if (componentName === 'View' || componentName === 'SafeAreaView') {
    return 'container';
  }

  return 'unknown';
}

/**
 * Get component name from React element
 */
function getComponentName(target: RNComponentRef): string {
  if (!target) return 'unknown';

  // Try type.displayName or type.name
  if (target.type?.displayName) return target.type.displayName;
  if (target.type?.name) return target.type.name;

  // Try constructor name
  if (target.constructor?.name) return target.constructor.name;

  // Try _fiber.type.name (React internals)
  if (target._fiber?.type?.name) return target._fiber.type.name;

  return 'unknown';
}

/**
 * Extract text content from element and children
 */
function extractTextContent(target: RNComponentRef): string | undefined {
  if (!target) return undefined;

  // Direct text prop (for Text components)
  if (typeof target.props?.children === 'string') {
    return target.props.children.trim();
  }

  // Button title
  if (typeof target.props?.title === 'string') {
    return target.props.title;
  }

  // TextInput value or placeholder
  if (typeof target.props?.value === 'string') {
    return target.props.value;
  }
  if (typeof target.props?.placeholder === 'string') {
    return target.props.placeholder;
  }

  // Try to extract from children (shallow)
  const children = target.props?.children;
  if (Array.isArray(children)) {
    const texts = (children as unknown[])
      .filter((child): child is string => typeof child === 'string')
      .map((text) => text.trim())
      .filter(Boolean);

    if (texts.length > 0) {
      return texts.join(' ').substring(0, 100); // Limit length
    }
  }

  return undefined;
}

/**
 * Measure element bounds using UIManager
 */
export function measureElement(target: RNComponentRef): Promise<ViewMeasurement | null> {
  let timeoutId: ReturnType<typeof setTimeout>;
  let settled = false;

  return new Promise<ViewMeasurement | null>((resolve) => {
    const settle = (value: ViewMeasurement | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };

    // Timeout if UIManager.measure callback never fires (e.g., unmounted view)
    timeoutId = setTimeout(() => settle(null), 500);

    try {
      // findNodeHandle expects React.Component; RNComponentRef is our structural
      // approximation of the same runtime object, so a cast is necessary here.
      const handle = findNodeHandle(target as unknown as React.Component);
      if (!handle) {
        settle(null);
        return;
      }

      UIManager.measure(
        handle,
        (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => {
          settle({ x, y, width, height, pageX, pageY });
        }
      );
    } catch (error) {
      console.warn('Failed to measure element:', error);
      settle(null);
    }
  });
}

/**
 * Find the closest interactive element in the hierarchy
 * (Similar to web's findInteractiveElement but for React Native)
 */
export function findInteractiveParent(target: RNComponentRef | null | undefined): RNComponentRef | null {
  if (!target) return null;

  let current: RNComponentRef | undefined = target;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    const type = detectElementType(current);

    // Stop at interactive elements
    if (
      type === 'button' ||
      type === 'pressable' ||
      type === 'input' ||
      type === 'touchable'
    ) {
      return current;
    }

    // Move up the tree
    current = current._owner ?? current.return;
    depth++;
  }

  return target; // Return original if no interactive parent found
}

/**
 * Convert RN-specific ExtractedElementInfo to the canonical ElementInfo from @gremlin/session.
 *
 * Normalizes React Native's `testID` (capital D) to the session package's `testId` (lowercase d).
 * The `testID` casing is kept only at the RN boundary where `View.props.testID` is read;
 * all downstream code uses `testId` for consistency with the session schema.
 */
export function toElementInfo(extracted: ExtractedElementInfo): Omit<ElementInfo, 'bounds'> {
  return {
    testId: extracted.testID,
    accessibilityLabel: extracted.accessibilityLabel,
    text: extracted.text,
    type: extracted.type as ElementType,
  };
}
