/**
 * AI Provider Helpers
 *
 * Detect AI provider and retrieve API keys from environment variables.
 */

/**
 * Auto-detect the AI provider based on which API key env var is set.
 */
export function detectProvider(): 'anthropic' | 'openai' | 'gemini' | undefined {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return undefined;
}

/**
 * Get the API key for the given AI provider from environment variables.
 */
export function getApiKey(provider: 'anthropic' | 'openai' | 'gemini'): string | undefined {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'gemini':
      return process.env.GEMINI_API_KEY;
  }
}
