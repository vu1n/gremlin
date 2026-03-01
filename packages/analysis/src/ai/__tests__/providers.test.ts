/**
 * Tests for AI provider transport contracts and prompt composition.
 *
 * Covers:
 * - callAIProvider dispatch to each provider (openai, anthropic, gemini)
 * - Correct API URLs and headers per provider
 * - Successful response parsing for each provider's response shape
 * - Empty/missing content error handling
 * - Non-2xx HTTP status error propagation
 * - buildAnalysisPrompt structure and content
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { callAIProvider, buildAnalysisPrompt } from '../providers.ts';
import type { AIProvider } from '../providers.ts';

// ============================================================================
// Fetch mock helpers
// ============================================================================

let originalFetch: typeof globalThis.fetch;
let capturedRequests: Array<{ url: string; init: RequestInit }>;
let nextResponse: Response;

function installFetchMock() {
  originalFetch = globalThis.fetch;
  capturedRequests = [];
  nextResponse = new Response('{}', { status: 200 });
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    capturedRequests.push({ url: url as string, init: init! });
    return Promise.resolve(nextResponse);
  }) as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

/** Set the response that the next fetch call will return. */
function mockFetchResponse(response: Response) {
  nextResponse = response;
}

/** Return a mock Response with a JSON body and the given status. */
function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Return a mock Response for a non-2xx error. */
function errorResponse(status: number, statusText: string, body = ''): Response {
  return new Response(body, { status, statusText });
}

// ============================================================================
// Provider dispatch tests
// ============================================================================

describe('callAIProvider()', () => {
  beforeEach(() => installFetchMock());
  afterEach(() => restoreFetch());

  // --------------------------------------------------------------------------
  // Anthropic
  // --------------------------------------------------------------------------

  describe('anthropic provider', () => {
    test('sends request to correct URL with correct headers', async () => {
      mockFetchResponse(jsonResponse({ content: [{ text: 'result' }] }));

      await callAIProvider('anthropic', 'sk-ant-test', 'hello');

      expect(capturedRequests).toHaveLength(1);
      const { url, init } = capturedRequests[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-test');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('sends correct body with default model and maxTokens', async () => {
      mockFetchResponse(jsonResponse({ content: [{ text: 'ok' }] }));

      await callAIProvider('anthropic', 'key', 'my prompt');

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.model).toBe('claude-sonnet-4-20250514');
      expect(body.max_tokens).toBe(8192);
      expect(body.messages).toEqual([{ role: 'user', content: 'my prompt' }]);
    });

    test('uses custom model and maxTokens when provided', async () => {
      mockFetchResponse(jsonResponse({ content: [{ text: 'ok' }] }));

      await callAIProvider('anthropic', 'key', 'prompt', {
        model: 'claude-3-haiku-20240307',
        maxTokens: 1024,
      });

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.model).toBe('claude-3-haiku-20240307');
      expect(body.max_tokens).toBe(1024);
    });

    test('parses successful response with content[0].text', async () => {
      mockFetchResponse(jsonResponse({ content: [{ text: 'AI analysis result' }] }));

      const result = await callAIProvider('anthropic', 'key', 'prompt');
      expect(result).toBe('AI analysis result');
    });

    test('throws on empty content array', async () => {
      mockFetchResponse(jsonResponse({ content: [] }));

      await expect(callAIProvider('anthropic', 'key', 'prompt')).rejects.toThrow(
        'No content in Anthropic response',
      );
    });

    test('throws on missing content field', async () => {
      mockFetchResponse(jsonResponse({ id: 'msg_123' }));

      await expect(callAIProvider('anthropic', 'key', 'prompt')).rejects.toThrow(
        'No content in Anthropic response',
      );
    });

    test('throws on null text in content block', async () => {
      mockFetchResponse(jsonResponse({ content: [{ text: null }] }));

      await expect(callAIProvider('anthropic', 'key', 'prompt')).rejects.toThrow(
        'No content in Anthropic response',
      );
    });

    test('throws with status and body on non-2xx response', async () => {
      mockFetchResponse(errorResponse(429, 'Too Many Requests', '{"error":"rate limited"}'));

      await expect(callAIProvider('anthropic', 'key', 'prompt')).rejects.toThrow(
        /Anthropic API error: 429 Too Many Requests.*rate limited/,
      );
    });

    test('throws with status only when error body is empty', async () => {
      mockFetchResponse(errorResponse(500, 'Internal Server Error'));

      await expect(callAIProvider('anthropic', 'key', 'prompt')).rejects.toThrow(
        'Anthropic API error: 500 Internal Server Error',
      );
    });
  });

  // --------------------------------------------------------------------------
  // OpenAI
  // --------------------------------------------------------------------------

  describe('openai provider', () => {
    test('sends request to correct URL with correct headers', async () => {
      mockFetchResponse(
        jsonResponse({ choices: [{ message: { content: 'result' } }] }),
      );

      await callAIProvider('openai', 'sk-openai-test', 'hello');

      expect(capturedRequests).toHaveLength(1);
      const { url, init } = capturedRequests[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-openai-test');
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('sends correct body with default model and maxTokens', async () => {
      mockFetchResponse(
        jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
      );

      await callAIProvider('openai', 'key', 'my prompt');

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.model).toBe('gpt-4o');
      expect(body.max_tokens).toBe(8192);
      expect(body.messages).toEqual([{ role: 'user', content: 'my prompt' }]);
    });

    test('uses custom model and maxTokens when provided', async () => {
      mockFetchResponse(
        jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
      );

      await callAIProvider('openai', 'key', 'prompt', {
        model: 'gpt-3.5-turbo',
        maxTokens: 2048,
      });

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.model).toBe('gpt-3.5-turbo');
      expect(body.max_tokens).toBe(2048);
    });

    test('parses successful response with choices[0].message.content', async () => {
      mockFetchResponse(
        jsonResponse({
          choices: [{ message: { content: 'OpenAI analysis' }, finish_reason: 'stop' }],
        }),
      );

      const result = await callAIProvider('openai', 'key', 'prompt');
      expect(result).toBe('OpenAI analysis');
    });

    test('throws on empty choices array', async () => {
      mockFetchResponse(jsonResponse({ choices: [] }));

      await expect(callAIProvider('openai', 'key', 'prompt')).rejects.toThrow(
        'No content in OpenAI response',
      );
    });

    test('throws on missing message content', async () => {
      mockFetchResponse(
        jsonResponse({ choices: [{ message: { content: null } }] }),
      );

      await expect(callAIProvider('openai', 'key', 'prompt')).rejects.toThrow(
        'No content in OpenAI response',
      );
    });

    test('throws on missing choices field', async () => {
      mockFetchResponse(jsonResponse({ id: 'chatcmpl-123' }));

      await expect(callAIProvider('openai', 'key', 'prompt')).rejects.toThrow(
        'No content in OpenAI response',
      );
    });

    test('throws with status and body on non-2xx response', async () => {
      mockFetchResponse(
        errorResponse(401, 'Unauthorized', '{"error":{"message":"Invalid API key"}}'),
      );

      await expect(callAIProvider('openai', 'key', 'prompt')).rejects.toThrow(
        /OpenAI API error: 401 Unauthorized.*Invalid API key/,
      );
    });

    test('throws with status only when error body is empty', async () => {
      mockFetchResponse(errorResponse(503, 'Service Unavailable'));

      await expect(callAIProvider('openai', 'key', 'prompt')).rejects.toThrow(
        'OpenAI API error: 503 Service Unavailable',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Gemini
  // --------------------------------------------------------------------------

  describe('gemini provider', () => {
    test('sends request to correct URL with model in path and correct headers', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'result' }] } }],
        }),
      );

      await callAIProvider('gemini', 'gemini-api-key', 'hello');

      expect(capturedRequests).toHaveLength(1);
      const { url, init } = capturedRequests[0];
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      );
      expect(init.method).toBe('POST');

      const headers = init.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('gemini-api-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    test('embeds custom model name in URL', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
      );

      await callAIProvider('gemini', 'key', 'prompt', { model: 'gemini-1.5-pro' });

      const { url } = capturedRequests[0];
      expect(url).toContain('/models/gemini-1.5-pro:generateContent');
    });

    test('sends correct body with contents and generationConfig', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
      );

      await callAIProvider('gemini', 'key', 'my prompt');

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.contents).toEqual([{ parts: [{ text: 'my prompt' }] }]);
      expect(body.generationConfig).toEqual({ maxOutputTokens: 8192 });
    });

    test('uses custom maxTokens in generationConfig', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
        }),
      );

      await callAIProvider('gemini', 'key', 'prompt', { maxTokens: 4096 });

      const body = JSON.parse(capturedRequests[0].init.body as string);
      expect(body.generationConfig.maxOutputTokens).toBe(4096);
    });

    test('parses successful response with candidates[0].content.parts[0].text', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: 'Gemini analysis result' }] },
              finishReason: 'STOP',
            },
          ],
        }),
      );

      const result = await callAIProvider('gemini', 'key', 'prompt');
      expect(result).toBe('Gemini analysis result');
    });

    test('throws on empty candidates array', async () => {
      mockFetchResponse(jsonResponse({ candidates: [] }));

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        'No content in Gemini response',
      );
    });

    test('throws on missing parts in content', async () => {
      mockFetchResponse(
        jsonResponse({ candidates: [{ content: { parts: [] } }] }),
      );

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        'No content in Gemini response',
      );
    });

    test('throws on missing candidates field', async () => {
      mockFetchResponse(jsonResponse({ promptFeedback: {} }));

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        'No content in Gemini response',
      );
    });

    test('throws on null text in parts', async () => {
      mockFetchResponse(
        jsonResponse({
          candidates: [{ content: { parts: [{ text: null }] } }],
        }),
      );

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        'No content in Gemini response',
      );
    });

    test('throws with status and body on non-2xx response', async () => {
      mockFetchResponse(
        errorResponse(403, 'Forbidden', '{"error":{"message":"API key invalid"}}'),
      );

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        /Gemini API error: 403 Forbidden.*API key invalid/,
      );
    });

    test('throws with status only when error body is empty', async () => {
      mockFetchResponse(errorResponse(500, 'Internal Server Error'));

      await expect(callAIProvider('gemini', 'key', 'prompt')).rejects.toThrow(
        'Gemini API error: 500 Internal Server Error',
      );
    });
  });

  // --------------------------------------------------------------------------
  // Unknown provider
  // --------------------------------------------------------------------------

  describe('unknown provider', () => {
    test('throws for unrecognized provider name', () => {
      expect(() =>
        callAIProvider('mistral' as AIProvider, 'key', 'prompt'),
      ).toThrow('Unknown provider: mistral');
    });
  });
});

// ============================================================================
// buildAnalysisPrompt tests
// ============================================================================

describe('buildAnalysisPrompt()', () => {
  const sampleSessionData = 'Session 1: user navigated Home -> Cart -> Checkout';

  test('returns a string containing the sessions data', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain(sampleSessionData);
  });

  test('contains required JSON instruction clause', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain('Output ONLY the JSON');
  });

  test('contains JSON output format specification', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"uxIssues"');
    expect(prompt).toContain('"errors"');
    expect(prompt).toContain('"patterns"');
    expect(prompt).toContain('"recommendations"');
  });

  test('contains analyst role instruction', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain('expert UX analyst');
  });

  // --------------------------------------------------------------------------
  // Focus-specific prompt templates
  // --------------------------------------------------------------------------

  test('ux focus produces UX-specific instructions', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'ux');
    expect(prompt).toContain('Focus primarily on UX issues');
    expect(prompt).toContain('confusing flows');
    expect(prompt).toContain('dead ends');
  });

  test('errors focus produces error-specific instructions', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'errors');
    expect(prompt).toContain('Focus primarily on errors');
    expect(prompt).toContain('JavaScript errors');
    expect(prompt).toContain('network failures');
  });

  test('performance focus produces performance-specific instructions', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'performance');
    expect(prompt).toContain('Focus primarily on performance');
    expect(prompt).toContain('Web Vitals');
    expect(prompt).toContain('LCP');
    expect(prompt).toContain('long tasks');
  });

  test('all focus produces comprehensive instructions', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain('Analyze all aspects');
    expect(prompt).toContain('UX issues');
    expect(prompt).toContain('errors');
    expect(prompt).toContain('performance');
  });

  test('unknown focus falls back to "all" instructions', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'nonexistent');
    expect(prompt).toContain('Analyze all aspects');
  });

  test('different focus values produce different prompt content', () => {
    const uxPrompt = buildAnalysisPrompt(sampleSessionData, 'ux');
    const errorsPrompt = buildAnalysisPrompt(sampleSessionData, 'errors');
    const perfPrompt = buildAnalysisPrompt(sampleSessionData, 'performance');
    const allPrompt = buildAnalysisPrompt(sampleSessionData, 'all');

    // Each focus should produce a unique focus section
    const focusSections = new Set([uxPrompt, errorsPrompt, perfPrompt, allPrompt]);
    expect(focusSections.size).toBe(4);
  });

  test('embeds session data in the Sessions Data section', () => {
    const data = 'Session A: click -> scroll -> click\nSession B: load -> error';
    const prompt = buildAnalysisPrompt(data, 'all');

    // Data should appear after the "Sessions Data" heading
    expect(prompt).toContain('## Sessions Data');
    expect(prompt).toContain(data);
  });

  test('contains structured analysis sections', () => {
    const prompt = buildAnalysisPrompt(sampleSessionData, 'all');
    expect(prompt).toContain('**Summary**');
    expect(prompt).toContain('**UX Issues**');
    expect(prompt).toContain('**Errors**');
    expect(prompt).toContain('**Patterns**');
    expect(prompt).toContain('**Recommendations**');
  });
});
