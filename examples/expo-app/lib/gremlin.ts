/**
 * Gremlin configuration for the Expo demo app.
 *
 * Re-exports from @gremlin/recorder-react-native. App-specific
 * configuration (app name, version, feature flags) lives here so
 * the rest of the app just imports from this module.
 */

export {
  GremlinRecorder,
  GremlinProvider,
  useGremlin,
} from '@gremlin/recorder-react-native';

export type {
  GremlinRecorderConfig,
} from '@gremlin/recorder-react-native';

export type {
  GremlinSession,
  DeviceInfo,
  AppInfo,
  ElementInfo,
} from '@gremlin/session';
export { EventTypeEnum } from '@gremlin/session';
