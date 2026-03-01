/**
 * Framework detection utilities — re-export shim
 *
 * Domain logic has moved to commands/shared/detect.ts.
 * This file re-exports for backward compatibility with external consumers.
 */

export {
  detectFramework,
  formatFramework,
  getFrameworkInfo,
  findEntryPoint,
  getInitCode,
  type Framework,
} from './commands/shared/detect.ts';
