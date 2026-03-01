export type AIProvider = 'anthropic' | 'openai' | 'gemini';

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
};

export function callAIProvider(
  provider: AIProvider,
  apiKey: string,
  prompt: string,
  options?: { model?: string; maxTokens?: number }
): Promise<string> {
  const model = options?.model ?? DEFAULT_MODELS[provider];
  const maxTokens = options?.maxTokens ?? 8192;

  switch (provider) {
    case 'anthropic':
      return callAnthropic(apiKey, model, prompt, maxTokens);
    case 'openai':
      return callOpenAI(apiKey, model, prompt, maxTokens);
    case 'gemini':
      return callGemini(apiKey, model, prompt, maxTokens);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('No content in Anthropic response');
  return content;
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in OpenAI response');
  return content;
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ''}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('No content in Gemini response');
  return content;
}

export function buildAnalysisPrompt(sessionsData: string, focus: string): string {
  const focusInstructions: Record<string, string> = {
    ux: 'Focus primarily on UX issues: confusing flows, dead ends, excessive steps, unclear navigation.',
    errors: 'Focus primarily on errors: JavaScript errors, network failures, crash patterns, error recovery.',
    performance: 'Focus primarily on performance: Web Vitals (LCP, CLS, INP, FCP, TTFB), long tasks, FPS drops during interactions, memory usage, page load time, and slow network calls.',
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
