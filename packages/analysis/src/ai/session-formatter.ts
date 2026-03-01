import type { GremlinSession } from '@gremlin/session';

export interface FormatOptions {
  maxSessions?: number;
  maxEventsPerSession?: number;
}

export function formatSessionsForPrompt(
  sessions: GremlinSession[],
  options?: FormatOptions
): string {
  const { maxSessions, maxEventsPerSession } = options ?? {};
  const lines: string[] = [];

  const limitedSessions = maxSessions ? sessions.slice(0, maxSessions) : sessions;

  if (maxSessions && sessions.length > maxSessions) {
    lines.push(`> Note: Showing ${maxSessions} of ${sessions.length} sessions (most recent).`);
    lines.push('');
  }

  for (let i = 0; i < limitedSessions.length; i++) {
    const session = limitedSessions[i];
    const allEvents = session.events || [];
    const events = maxEventsPerSession ? allEvents.slice(0, maxEventsPerSession) : allEvents;

    lines.push(`### Session ${i + 1}`);
    lines.push(`- Platform: ${session.header.device?.platform || 'unknown'}`);
    if (session.header.device?.osVersion) {
      lines.push(`- OS: ${session.header.device.osVersion}`);
    }
    lines.push(`- App: ${session.header.app?.name || 'unknown'} v${session.header.app?.version || '?'}`);

    if (maxEventsPerSession) {
      lines.push(`- Events: ${events.length}${allEvents.length > maxEventsPerSession ? ` (of ${allEvents.length}, truncated)` : ''}`);
      const duration = events.length > 0 ? events.reduce((sum, e) => sum + (e.dt || 0), 0) / 1000 : 0;
      lines.push(`- Duration: ${duration.toFixed(1)}s`);
    }

    const perfLine = formatSessionPerformance(session.performance);
    if (perfLine) {
      lines.push(`- Performance: ${perfLine}`);
    }

    lines.push('');
    lines.push('Events:');

    let timestamp = 0;
    for (const event of events) {
      timestamp += event.dt;
      const eventStr = formatEvent(session, event, timestamp);
      lines.push(`  ${eventStr}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function formatSessionPerformance(
  perf: GremlinSession['performance']
): string | null {
  if (!perf) return null;

  const parts: string[] = [];
  if (perf.webVitals) {
    const wv = perf.webVitals;
    if (wv.lcp !== undefined) parts.push(`LCP=${wv.lcp}ms`);
    if (wv.cls !== undefined) parts.push(`CLS=${wv.cls}`);
    if (wv.inp !== undefined) parts.push(`INP=${wv.inp}ms`);
    if (wv.fcp !== undefined) parts.push(`FCP=${wv.fcp}ms`);
    if (wv.ttfb !== undefined) parts.push(`TTFB=${wv.ttfb}ms`);
  }
  if (perf.avgFps !== undefined) parts.push(`avgFPS=${perf.avgFps}`);
  if (perf.minFps !== undefined) parts.push(`minFPS=${perf.minFps}`);
  if (perf.longTaskCount !== undefined) parts.push(`longTasks=${perf.longTaskCount}`);
  if (perf.peakMemoryUsage !== undefined) parts.push(`peakMem=${perf.peakMemoryUsage}MB`);
  if (perf.pageLoadTime !== undefined) parts.push(`pageLoad=${perf.pageLoadTime}ms`);

  return parts.length > 0 ? parts.join(', ') : null;
}

export function formatPerfSuffix(perf: GremlinSession['events'][0]['perf']): string {
  if (!perf) return '';

  const parts: string[] = [];
  if (perf.fps !== undefined) parts.push(`fps=${perf.fps}`);
  if (perf.jsThreadLag !== undefined && perf.jsThreadLag > 50) parts.push(`lag=${perf.jsThreadLag}ms`);
  if (perf.longTaskCount !== undefined && perf.longTaskCount > 0) parts.push(`longTasks=${perf.longTaskCount}`);

  return parts.length > 0 ? ` [perf: ${parts.join(', ')}]` : '';
}

export function formatEvent(
  session: GremlinSession,
  event: GremlinSession['events'][0],
  timestamp: number
): string {
  const timeStr = `[${(timestamp / 1000).toFixed(1)}s]`;
  const data = event.data;
  const perfSuffix = formatPerfSuffix(event.perf);

  if ('kind' in data) {
    switch (data.kind) {
      case 'tap':
      case 'double_tap':
      case 'long_press': {
        const elements = session.elements ?? [];
        const element = data.elementIndex !== undefined && data.elementIndex < elements.length
          ? elements[data.elementIndex]
          : null;
        const elementStr = element
          ? `${element.testId || element.accessibilityLabel || element.text || 'unknown'}${element.type ? ` (${element.type})` : ''}`
          : `(${data.x}, ${data.y})`;
        return `${timeStr} ${data.kind.toUpperCase()}: ${elementStr}${perfSuffix}`;
      }

      case 'swipe':
        return `${timeStr} SWIPE: ${data.direction} (${data.duration}ms)${perfSuffix}`;

      case 'scroll':
        return `${timeStr} SCROLL: deltaY=${data.deltaY}${perfSuffix}`;

      case 'input': {
        const elements = session.elements ?? [];
        const inputElement = data.elementIndex !== undefined && data.elementIndex < elements.length
          ? elements[data.elementIndex]
          : null;
        const inputTarget = inputElement?.testId || inputElement?.accessibilityLabel || 'unknown';
        return `${timeStr} INPUT: ${inputTarget} = "${data.masked ? '***' : data.value}"${perfSuffix}`;
      }

      case 'navigation':
        return `${timeStr} NAVIGATE: ${data.navType} → ${data.screen}${perfSuffix}`;

      case 'network':
        return `${timeStr} NETWORK: ${data.method} ${data.url} (${data.phase})${perfSuffix}`;

      case 'error':
        return `${timeStr} ERROR: ${data.message}${perfSuffix}`;

      case 'app_state':
        return `${timeStr} APP_STATE: ${data.state}${perfSuffix}`;

      default:
        return `${timeStr} ${data.kind?.toUpperCase?.() || 'EVENT'}${perfSuffix}`;
    }
  }

  return `${timeStr} EVENT: ${JSON.stringify(data)}${perfSuffix}`;
}

export function parseJsonResponse(raw: string): unknown {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
  return JSON.parse(jsonStr);
}
