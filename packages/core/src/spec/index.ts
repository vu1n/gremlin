/**
 * GremlinSpec - TLA+-compatible state machine specification
 *
 * This module contains the core types and utilities for defining
 * application behavior as a formal state machine model.
 *
 * The spec can be:
 * - Generated from AST analysis (static code analysis)
 * - Generated from session recordings (observed behavior)
 * - Merged from both sources (hybrid approach)
 *
 * The spec can be compiled to:
 * - TLA+ for formal verification
 * - Playwright tests for web
 * - Maestro tests for mobile
 * - XState for visualization
 */

// Re-export all types
export * from './types';
