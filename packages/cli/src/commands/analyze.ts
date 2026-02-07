/**
 * Analyze Command
 *
 * Uses AI to generate actionable insights from recorded sessions.
 * Unlike `generate` which produces tests, `analyze` focuses on
 * understanding user behavior, identifying UX issues, and surfacing
 * errors and patterns.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { GremlinSession } from '@gremlin/session';
import { output, outputError, type OutputOptions } from '../output.ts';

// ============================================================================
// Types
// ============================================================================

export interface AnalyzeOptions extends OutputOptions {
  input?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
  focus?: 'ux' | 'errors' | 'performance' | 'all';
}

export interface AnalyzeResult {
  sessionCount: number;
  totalEvents: number;
  provider: string;
  focus: string;
  insights: {
    summary: string;
    uxIssues: string[];
    errors: string[];
    patterns: string[];
    recommendations: string[];
  };
}

// ============================================================================
// Main Command
// ============================================================================

export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult | null> {
  const {
    input = '.gremlin/sessions',
    provider = detectProvider(),
    focus = 'all',
    json,
  } = options;

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    const msg = `No API key found for ${provider}. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY`;
    if (outputError('analyze', [msg], options)) process.exit(1);
    console.error(msg);
    process.exit(1);
  }

  if (!existsSync(input)) {
    const msg = `Sessions directory not found: ${input}. Run "gremlin dev" first to record sessions.`;
    if (outputError('analyze', [msg], options)) process.exit(1);
    console.error(msg);
    process.exit(1);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    const msg = 'No sessions found. Use your app while "gremlin dev" is running to record sessions.';
    if (outputError('analyze', [msg], options)) process.exit(1);
    console.error(msg);
    process.exit(1);
  }

  if (!json) {
    console.log('');
    console.log('Gremlin Analyze');
    console.log('===============');
    console.log('');
    console.log(`  Sessions: ${sessions.length}`);
    console.log(`  Provider: ${provider}`);
    console.log(`  Focus:    ${focus}`);
    console.log('');
    console.log('  Analyzing sessions with AI...');
  }

  const sessionsPrompt = formatSessionsForAnalysis(sessions);
  const prompt = buildAnalysisPrompt(sessionsPrompt, focus);
  const rawResponse = await callAIProvider(provider, apiKey, prompt);
  const insights = parseInsightsResponse(rawResponse);

  const result: AnalyzeResult = {
    sessionCount: sessions.length,
    totalEvents: sessions.reduce((sum, s) => sum + (s.events?.length ?? 0), 0),
    provider,
    focus,
    insights,
  };

  if (output('analyze', result, options)) return result;

  // Human-readable output
  console.log('');
  console.log(`  Summary: ${insights.summary}`);

  if (insights.uxIssues.length > 0) {
    console.log('');
    console.log('  UX Issues:');
    for (const issue of insights.uxIssues) {
      console.log(`    - ${issue}`);
    }
  }

  if (insights.errors.length > 0) {
    console.log('');
    console.log('  Errors Found:');
    for (const error of insights.errors) {
      console.log(`    - ${error}`);
    }
  }

  if (insights.patterns.length > 0) {
    console.log('');
    console.log('  User Patterns:');
    for (const pattern of insights.patterns) {
      console.log(`    - ${pattern}`);
    }
  }

  if (insights.recommendations.length > 0) {
    console.log('');
    console.log('  Recommendations:');
    for (const rec of insights.recommendations) {
      console.log(`    - ${rec}`);
    }
  }

  console.log('');
  return result;
}

// ============================================================================
// Session Loading
// ============================================================================

async function loadSessions(dir: string): Promise<GremlinSession[]> {
  const sessions: GremlinSession[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = await Bun.file(join(dir, file)).text();
      sessions.push(JSON.parse(content) as GremlinSession);
    } catch {
      // skip invalid files
    }
  }

  return sessions;
}

// ============================================================================
// Prompt Building
// ============================================================================

function formatSessionsForAnalysis(sessions: GremlinSession[]): string {
  const lines: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const events = session.events || [];
    const duration = events.length > 0 ? Math.max(...events.map((e) => e.dt || 0)) / 1000 : 0;

    lines.push(`### Session ${i + 1}`);
    lines.push(`- Platform: ${session.header.device?.platform || 'unknown'}`);
    lines.push(`- App: ${session.header.app?.name || 'unknown'} v${session.header.app?.version || '?'}`);
    lines.push(`- Events: ${events.length}`);
    lines.push(`- Duration: ${duration.toFixed(1)}s`);
    lines.push('');
    lines.push('Events:');

    let timestamp = 0;
    for (const event of events) {
      timestamp += event.dt;
      const timeStr = `[${(timestamp / 1000).toFixed(1)}s]`;
      const data = event.data;

      if ('kind' in data) {
        switch (data.kind) {
          case 'tap':
          case 'double_tap':
          case 'long_press': {
            const el = data.elementIndex !== undefined ? session.elements?.[data.elementIndex] : null;
            const target = el ? (el.testId || el.accessibilityLabel || el.text || 'unknown') : `(${data.x}, ${data.y})`;
            lines.push(`  ${timeStr} ${data.kind.toUpperCase()}: ${target}`);
            break;
          }
          case 'input': {
            const el = data.elementIndex !== undefined ? session.elements?.[data.elementIndex] : null;
            const target = el?.testId || el?.accessibilityLabel || 'unknown';
            lines.push(`  ${timeStr} INPUT: ${target} = "${data.masked ? '***' : data.value}"`);
            break;
          }
          case 'navigation':
            lines.push(`  ${timeStr} NAVIGATE: ${data.navType} → ${data.screen}`);
            break;
          case 'error':
            lines.push(`  ${timeStr} ERROR: ${data.message}`);
            break;
          case 'network':
            lines.push(`  ${timeStr} NETWORK: ${data.method} ${data.url} (${data.phase})`);
            break;
          default:
            lines.push(`  ${timeStr} ${data.kind?.toUpperCase?.() || 'EVENT'}`);
        }
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

function buildAnalysisPrompt(sessionsData: string, focus: string): string {
  const focusInstructions: Record<string, string> = {
    ux: 'Focus primarily on UX issues: confusing flows, dead ends, excessive steps, unclear navigation.',
    errors: 'Focus primarily on errors: JavaScript errors, network failures, crash patterns, error recovery.',
    performance: 'Focus primarily on performance: slow interactions, long load times, excessive network calls.',
    all: 'Analyze all aspects: UX issues, errors, performance, and general user behavior patterns.',
  };

  return `You are an expert UX analyst and application debugger. Analyze the following user session recordings and provide actionable insights.

## Sessions Data

${sessionsData}

## Focus
${focusInstructions[focus] || focusInstructions.all}

## Your Task

Analyze these sessions and produce structured insights:

1. **Summary**: A 1-2 sentence overview of what users are doing and how the app is performing.

2. **UX Issues**: Problems with the user experience — confusing flows, dead ends, rage clicks, excessive steps to complete tasks, unclear navigation.

3. **Errors**: JavaScript errors, network failures, unhandled states, crash-inducing patterns.

4. **Patterns**: Notable user behavior patterns — common flows, popular features, drop-off points, navigation habits.

5. **Recommendations**: Specific, actionable suggestions to improve the app based on the data.

## Output Format

Respond with a JSON object:

\`\`\`json
{
  "summary": "One or two sentence overview",
  "uxIssues": ["Issue 1", "Issue 2"],
  "errors": ["Error pattern 1"],
  "patterns": ["Pattern 1", "Pattern 2"],
  "recommendations": ["Recommendation 1", "Recommendation 2"]
}
\`\`\`

Be specific and reference actual events/screens from the sessions. If a category has no findings, use an empty array.

Output ONLY the JSON, no other text.`;
}

// ============================================================================
// AI Provider
// ============================================================================

async function callAIProvider(
  provider: 'anthropic' | 'openai' | 'gemini',
  apiKey: string,
  prompt: string
): Promise<string> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(apiKey, prompt);
    case 'openai':
      return callOpenAI(apiKey, prompt);
    case 'gemini':
      return callGemini(apiKey, prompt);
  }
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseInsightsResponse(raw: string): AnalyzeResult['insights'] {
  const fallback = {
    summary: 'Analysis could not be parsed.',
    uxIssues: [],
    errors: [],
    patterns: [],
    recommendations: [],
  };

  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();
    const parsed = JSON.parse(jsonStr);

    return {
      summary: parsed.summary ?? fallback.summary,
      uxIssues: Array.isArray(parsed.uxIssues) ? parsed.uxIssues : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch {
    return { ...fallback, summary: raw.slice(0, 200) };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function detectProvider(): 'anthropic' | 'openai' | 'gemini' {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return 'gemini';
}

function getApiKey(provider: 'anthropic' | 'openai' | 'gemini'): string | undefined {
  switch (provider) {
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'gemini': return process.env.GEMINI_API_KEY;
  }
}
