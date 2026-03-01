/**
 * Shared rrweb type definitions
 *
 * Enums and interfaces for rrweb event structures. Extracted into a
 * standalone module so both rrweb.ts (importer class) and rrweb-core.ts
 * (shared conversion pipeline) can import without circular deps.
 */

/**
 * rrweb event types
 */
export enum RrwebEventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
  Plugin = 6,
}

/**
 * Incremental snapshot sources (user interactions)
 */
export enum IncrementalSource {
  Mutation = 0,
  MouseMove = 1,
  MouseInteraction = 2,
  Scroll = 3,
  ViewportResize = 4,
  Input = 5,
  TouchMove = 6,
  MediaInteraction = 7,
  StyleSheetRule = 8,
  CanvasMutation = 9,
  Font = 10,
  Log = 11,
  Drag = 12,
  StyleDeclaration = 13,
}

/**
 * Mouse interaction types
 */
export enum MouseInteractions {
  MouseUp = 0,
  MouseDown = 1,
  Click = 2,
  ContextMenu = 3,
  DblClick = 4,
  Focus = 5,
  Blur = 6,
  TouchStart = 7,
  TouchMove_Departed = 8, // Deprecated
  TouchEnd = 9,
}

/**
 * Base rrweb event structure
 */
export interface RrwebEvent {
  type: RrwebEventType;
  timestamp: number;
  data: RrwebEventData;
}

/**
 * Union of all possible rrweb event data types
 */
export type RrwebEventData =
  | MetaData
  | FullSnapshotData
  | IncrementalSnapshotData
  | CustomEventData;

/**
 * Meta event data (page info)
 */
export interface MetaData {
  href: string;
  width: number;
  height: number;
}

/**
 * Full snapshot data (complete DOM tree)
 */
export interface FullSnapshotData {
  node: SerializedNode;
  initialOffset?: {
    top: number;
    left: number;
  };
}

/**
 * Incremental snapshot data (DOM changes and interactions)
 */
export interface IncrementalSnapshotData {
  source: IncrementalSource;
  positions?: MousePosition[];
  id?: number;
  x?: number;
  y?: number;
  type?: MouseInteractions;
  scrollData?: {
    id: number;
    x: number;
    y: number;
  };
  text?: string;
  isChecked?: boolean;
  source_type?: number;
  payload?: unknown;
  adds?: AddedNode[];
  removes?: RemovedNode[];
  texts?: TextMutation[];
  attributes?: AttributeMutation[];
}

/**
 * Custom event data
 */
export interface CustomEventData {
  tag: string;
  payload: unknown;
}

/**
 * Mouse position data
 */
export interface MousePosition {
  x: number;
  y: number;
  id: number;
  timeOffset: number;
}

/**
 * Serialized DOM node
 */
export interface SerializedNode {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, string>;
  childNodes?: SerializedNode[];
  textContent?: string;
  isSVG?: boolean;
}

/**
 * Added node in mutation
 */
export interface AddedNode {
  parentId: number;
  previousId?: number;
  nextId?: number;
  node: SerializedNode;
}

/**
 * Removed node in mutation
 */
export interface RemovedNode {
  parentId: number;
  id: number;
}

/**
 * Text content mutation
 */
export interface TextMutation {
  id: number;
  value: string;
}

/**
 * Attribute mutation
 */
export interface AttributeMutation {
  id: number;
  attributes: Record<string, string | null>;
}
