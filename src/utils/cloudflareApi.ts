const WORKER_URL = 'https://damp-haze-85c6.harshithayadali30.workers.dev';

interface CloudflareAIResponse {
  success: boolean;
  text?: string;
  provider?: string;
  model?: string;
  error?: string;
  details?: any[];
}

interface AIRequestOptions {
  prompt: string;
  model?: string;
  retries?: number;
}

export const callCloudflareAI = async (
  promptOrOptions: string | AIRequestOptions,
  retries = 2
): Promise<string> => {
  const options: AIRequestOptions = typeof promptOrOptions === 'string'
    ? { prompt: promptOrOptions, retries }
    : { retries: 2, ...promptOrOptions };

  for (let i = 0; i <= options.retries; i++) {
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: options.prompt,
          model: options.model
        }),
      });

      const data: CloudflareAIResponse = await response.json();

      if (data.success && data.text) {
        console.log(`✅ AI response from: ${data.provider}${data.model ? ` (${data.model})` : ''}`);
        return data.text;
      }

      if (i === options.retries) {
        throw new Error(data.error || 'All AI providers failed');
      }
    } catch (error: any) {
      if (i === options.retries) {
        console.error('Cloudflare Worker error:', error);
        throw new Error(`Failed to get AI response: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Failed after retries');
};

export const AI_MODELS = {
  GPT_4O_MINI: 'openai/gpt-4o-mini',
  GPT_4O: 'openai/gpt-4o',
  GEMINI_FLASH: 'google/gemini-2.0-flash-exp:free',
  CLAUDE_SONNET: 'anthropic/claude-3.5-sonnet',
  LLAMA_3_1: 'meta-llama/llama-3.1-8b-instruct:free',
  MISTRAL: 'mistralai/mistral-7b-instruct:free'
} as const;

/**
 * Call GitHub API through Cloudflare Worker proxy
 * @param endpoint - GitHub API endpoint (e.g., '/search/repositories')
 * @param params - URL search parameters
 * @returns GitHub API response
 */
export const callGitHubAPI = async <T = any>(
  endpoint: string,
  params?: Record<string, string>
): Promise<T> => {
  try {
    const url = new URL(`${WORKER_URL}/github${endpoint}`);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value);
      });
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `GitHub API error: ${response.status}`);
    }

    const data = await response.json();
    return data as T;
  } catch (error: any) {
    console.error('GitHub API request failed:', error);
    throw new Error(`Failed to fetch from GitHub API: ${error.message}`);
  }
};
