/**
 * EdenAI Text Generation Service
 * Routes all AI calls through Cloudflare Worker proxy for security
 * API keys are stored server-side in Cloudflare Worker, not in frontend
 */

import { cloudflareWorkerService } from './cloudflareWorkerService';

// Available providers: openai/gpt-4o-mini, google/gemini-1.5-flash, etc.
const DEFAULT_PROVIDER = 'openai/gpt-4o-mini';

console.log('EdenAI Text Service: Using Cloudflare Worker proxy');

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Generate text using Cloudflare Worker proxy
 */
export const generateText = async (
  prompt: string,
  options: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> => {
  const {
    provider = DEFAULT_PROVIDER,
    temperature = 0.3,
    maxTokens = 4000
  } = options;

  return cloudflareWorkerService.callAI(prompt, {
    provider,
    temperature,
    maxTokens
  });
};

/**
 * Chat with context using Cloudflare Worker proxy
 */
export const chat = async (
  messages: ChatMessage[],
  options: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> => {
  const {
    provider = DEFAULT_PROVIDER,
    temperature = 0.3,
    maxTokens = 4000
  } = options;

  // Convert messages to a single prompt for now
  // The worker can be enhanced later to support chat history
  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const conversationHistory = messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role}: ${m.content}`)
    .join('\n\n');

  const fullPrompt = systemMessage
    ? `${systemMessage}\n\n${conversationHistory}`
    : conversationHistory;

  return cloudflareWorkerService.callAI(fullPrompt, {
    provider,
    temperature,
    maxTokens
  });
};

/**
 * Generate text with retry logic (delegated to Cloudflare Worker)
 */
export const generateTextWithRetry = async (
  prompt: string,
  options: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
  } = {}
): Promise<string> => {
  const { maxRetries = 3, ...generateOptions } = options;

  return cloudflareWorkerService.callAIWithRetry(prompt, {
    ...generateOptions,
    maxRetries
  });
};

/**
 * Parse JSON from AI response
 */
export const parseJSONResponse = <T>(response: string): T => {
  return cloudflareWorkerService.parseJSONResponse<T>(response);
};

export const edenAITextService = {
  generateText,
  generateTextWithRetry,
  chat,
  parseJSONResponse
};
