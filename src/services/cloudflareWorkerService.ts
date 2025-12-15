/**
 * Cloudflare Worker Proxy Service
 * Securely proxies all AI and external API calls through Cloudflare Worker
 * This prevents API keys from being exposed in frontend code
 */

const CLOUDFLARE_WORKER_URL = import.meta.env.VITE_CLOUDFLARE_WORKER_URL || 'https://damp-haze-85c6.harshithayadali30.workers.dev';

console.log('Cloudflare Worker Service: Using URL:', CLOUDFLARE_WORKER_URL);

interface AIRequest {
  prompt: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
}

interface AIResponse {
  text: string;
  provider: string;
}

interface GitHubRepo {
  title: string;
  githubUrl: string;
  description: string;
  stars: number;
  language: string;
}

/**
 * Call AI through Cloudflare Worker proxy
 */
export const callAI = async (
  prompt: string,
  options: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> => {
  const {
    provider = 'openai/gpt-4o-mini',
    temperature = 0.3,
    maxTokens = 4000
  } = options;

  console.log('🔒 Calling AI through Cloudflare Worker proxy');
  console.log('   Provider:', provider);
  console.log('   Temperature:', temperature);
  console.log('   Max Tokens:', maxTokens);
  console.log('   Prompt length:', prompt.length, 'chars');

  try {
    const response = await fetch(CLOUDFLARE_WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        provider,
        temperature,
        maxTokens
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Cloudflare Worker AI error:', errorText);
      throw new Error(`Worker AI error: ${response.status} - ${errorText}`);
    }

    const data: AIResponse = await response.json();

    if (!data.text || data.text.trim().length === 0) {
      console.error('❌ Empty response from Worker');
      throw new Error('Empty response from AI worker');
    }

    console.log('✅ AI Response received from worker');
    console.log('   Provider used:', data.provider);
    console.log('   Response length:', data.text.length, 'chars');

    return data.text;
  } catch (error) {
    console.error('❌ Error calling Cloudflare Worker AI:', error);
    throw error;
  }
};

/**
 * Call AI with retry logic and provider fallback
 */
export const callAIWithRetry = async (
  prompt: string,
  options: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
  } = {}
): Promise<string> => {
  const { maxRetries = 3, ...aiOptions } = options;
  let lastError: Error | null = null;
  let delay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 Worker AI attempt ${attempt}/${maxRetries}...`);
      return await callAI(prompt, aiOptions);
    } catch (error) {
      lastError = error as Error;
      console.warn(`Worker AI attempt ${attempt}/${maxRetries} failed:`, error);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  throw lastError || new Error('Failed to generate text after retries');
};

/**
 * Fetch GitHub repositories through Cloudflare Worker proxy
 */
export const fetchGitHubRepos = async (
  query: string,
  options: {
    sort?: string;
    order?: string;
    perPage?: number;
  } = {}
): Promise<GitHubRepo[]> => {
  const {
    sort = 'stars',
    order = 'desc',
    perPage = 10
  } = options;

  console.log('🔒 Fetching GitHub repos through Cloudflare Worker proxy');
  console.log('   Query:', query);
  console.log('   Sort:', sort);
  console.log('   Per page:', perPage);

  try {
    const params = new URLSearchParams({
      q: query,
      sort,
      order,
      per_page: perPage.toString()
    });

    const response = await fetch(`${CLOUDFLARE_WORKER_URL}/github/search/repositories?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Cloudflare Worker GitHub error:', errorText);
      throw new Error(`Worker GitHub error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      console.warn('⚠️ No GitHub repos found for query:', query);
      return [];
    }

    const repos: GitHubRepo[] = data.items.slice(0, perPage).map((repo: any) => ({
      title: repo.name,
      githubUrl: repo.html_url,
      description: repo.description || '',
      stars: repo.stargazers_count,
      language: repo.language
    }));

    // Validate URLs before returning
    const validRepos = repos.filter((r: GitHubRepo) => r.githubUrl && r.githubUrl.startsWith('https://github.com/'));

    console.log('✅ GitHub repos fetched from worker:', validRepos.length);

    return validRepos;
  } catch (error) {
    console.error('❌ Error fetching GitHub repos through worker:', error);
    throw error;
  }
};

/**
 * Parse JSON from AI response
 */
export const parseJSONResponse = <T>(response: string): T => {
  if (!response || response.trim().length === 0) {
    console.error('❌ Empty response received for JSON parsing');
    throw new Error('Empty response from AI - cannot parse JSON');
  }

  // Clean the response
  let cleaned = response
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Try to extract JSON object or array from the response
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  console.log('🔍 Attempting to parse JSON, length:', cleaned.length);
  console.log('   First 200 chars:', cleaned.slice(0, 200));

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('❌ Failed to parse JSON response:', error);
    console.error('   Raw response:', cleaned.slice(0, 500));

    // Try to fix common JSON issues
    try {
      // Remove trailing commas before closing brackets
      const fixed = cleaned
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']');
      return JSON.parse(fixed);
    } catch (fixError) {
      console.error('❌ Failed to fix and parse JSON');
      throw new Error('Invalid JSON response from AI');
    }
  }
};

export const cloudflareWorkerService = {
  callAI,
  callAIWithRetry,
  fetchGitHubRepos,
  parseJSONResponse
};
