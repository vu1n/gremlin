/**
 * @gremlin/recorder-web - Web session recorder
 *
 * Records user sessions in the browser using rrweb and enriches events
 * with element identification for test generation.
 */

export const VERSION = '0.0.1';

export { GremlinRecorder, type RecorderConfig } from './recorder';
export { captureElement, findInteractiveElement } from './element-capture';
