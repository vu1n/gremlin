/**
 * Analyze Command
 *
 * Uses AI to generate actionable insights from recorded sessions.
 * Unlike `generate` which produces tests, `analyze` focuses on
 * understanding user behavior, identifying UX issues, and surfacing
 * errors and patterns.
 */

import { existsSync } from 'fs';
import {
  formatSessionsForPrompt,
  parseJsonResponse,
  callAIProvider,
  buildAnalysisPrompt,
} from '@gremlin/analysis';
import { output, exitWithError, type OutputOptions } from '../output.ts';
import { loadSessions } from './shared/sessions.ts';
import { detectProvider, getApiKey } from './shared/ai.ts';

interface AnalyzeOptions extends OutputOptions {
  input?: string;
  provider?: 'anthropic' | 'openai' | 'gemini';
  focus?: 'ux' | 'errors' | 'performance' | 'all';
}

interface AnalyzeResult {
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

export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const {
    input = '.gremlin/sessions',
    provider = detectProvider(),
    focus = 'all',
    json,
  } = options;

  if (!provider) {
    exitWithError('analyze', 'No AI provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY', options);
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    exitWithError('analyze', `No API key found for ${provider}. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY`, options);
  }

  if (!existsSync(input)) {
    exitWithError('analyze', `Sessions directory not found: ${input}. Run "gremlin dev" first to record sessions.`, options);
  }

  const sessions = await loadSessions(input);
  if (sessions.length === 0) {
    exitWithError('analyze', 'No sessions found. Use your app while "gremlin dev" is running to record sessions.', options);
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

  const sessionsPrompt = formatSessionsForPrompt(sessions, {
    maxSessions: 10,
    maxEventsPerSession: 200,
  });
  const prompt = buildAnalysisPrompt(sessionsPrompt, focus);
  const rawResponse = await callAIProvider(provider, apiKey, prompt, { maxTokens: 4096 });
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

function parseInsightsResponse(raw: string): AnalyzeResult['insights'] {
  const fallback = {
    summary: 'Analysis could not be parsed.',
    uxIssues: [],
    errors: [],
    patterns: [],
    recommendations: [],
  };

  try {
    const parsed = parseJsonResponse(raw) as Record<string, unknown>;

    return {
      summary: (parsed.summary as string) ?? fallback.summary,
      uxIssues: Array.isArray(parsed.uxIssues) ? parsed.uxIssues : [],
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    };
  } catch {
    return { ...fallback, summary: raw.slice(0, 200) };
  }
}
