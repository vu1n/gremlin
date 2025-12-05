/**
 * Element Capture - Extract element information from React Native views
 *
 * Uses React Native's view hierarchy and accessibility APIs to identify elements.
 */

import { findNodeHandle, UIManager } from 'react-native';
import type { ExtractedElementInfo, ViewMeasurement } from './types';

// Local type definitions
export type ElementType = 'button' | 'pressable' | 'input' | 'text' | 'image' |
  'scroll_view' | 'list' | 'modal' | 'container' | 'touchable' | 'unknown';

export interface ElementInfo {
  testId?: string;
  accessibilityLabel?: string;
  text?: string;
  type: ElementType;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Capture element information from a React Native component instance
 */
export async function captureElement(
  target: any
): Promise<ExtractedElementInfo | null> {
  if (!target) return null;

  try {
    const elementInfo: ExtractedElementInfo = {
      type: detectElementType(target),
    };

    // Extract testID (best for test generation)
    if (target.props?.testID) {
      elementInfo.testID = target.props.testID;
    }

    // Extract accessibility label
    if (target.props?.accessibilityLabel) {
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
function detectElementType(target: any): ElementType {
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
function getComponentName(target: any): string {
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
function extractTextContent(target: any): string | undefined {
  if (!target) return undefined;

  // Direct text prop (for Text components)
  if (typeof target.props?.children === 'string') {
    return target.props.children.trim();
  }

  // Button title
  if (target.props?.title) {
    return target.props.title;
  }

  // TextInput value or placeholder
  if (target.props?.value) {
    return target.props.value;
  }
  if (target.props?.placeholder) {
    return target.props.placeholder;
  }

  // Try to extract from children (shallow)
  if (Array.isArray(target.props?.children)) {
    const texts = target.props.children
      .filter((child: any) => typeof child === 'string')
      .map((text: string) => text.trim())
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
export function measureElement(target: any): Promise<ViewMeasurement | null> {
  return new Promise((resolve) => {
    try {
      const handle = findNodeHandle(target);
      if (!handle) {
        resolve(null);
        return;
      }

      UIManager.measure(
        handle,
        (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => {
          resolve({ x, y, width, height, pageX, pageY });
        }
      );
    } catch (error) {
      console.warn('Failed to measure element:', error);
      resolve(null);
    }
  });
}

/**
 * Find the closest interactive element in the hierarchy
 * (Similar to web's findInteractiveElement but for React Native)
 */
export function findInteractiveParent(target: any): any {
  if (!target) return null;

  let current = target;
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
    current = current._owner || current.return;
    depth++;
  }

  return target; // Return original if no interactive parent found
}

/**
 * Convert extracted element info to core ElementInfo format
 */
export function toElementInfo(extracted: ExtractedElementInfo): Omit<ElementInfo, 'bounds'> {
  return {
    testId: extracted.testID,
    accessibilityLabel: extracted.accessibilityLabel,
    text: extracted.text,
    type: extracted.type as ElementType,
  };
}
