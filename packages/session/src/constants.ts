/**
 * Shared constants for session format versioning.
 *
 * SCHEMA_VERSION is used in both session headers and analysis spec objects
 * to mark the data format. Bump this when the session/spec shape changes
 * in a backward-incompatible way.
 *
 * SDK_VERSION tracks the package version of @gremlin/session.
 */

export const SCHEMA_VERSION = 1;
export const SDK_VERSION = '0.0.1';
