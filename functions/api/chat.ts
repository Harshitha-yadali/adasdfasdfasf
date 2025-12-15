// functions/api/chat.ts (Direct Worker Call)

interface RequestBody {
  prompt: string;
}

interface CloudflareEnv {
  EDENAI_API_KEY?: string;
  VITE_EDENAI_API_KEY?: string;
  WORKER_URL?: string;
}

interface CloudflareContext {
  request: Request;
  env: CloudflareEnv;
}

const DEFAULT_WORKER_URL = 'https://damp-haze-85c6.harshithayadali30.workers.dev';

export async function onRequestPost(context: CloudflareContext) {
  const { request, env } = context;

  try {
    // Parse incoming request
    const body = await request.json() as RequestBody;
    const { prompt } = body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Prompt is required and must be a non-empty string' 
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Get Worker URL from environment or use default
    const workerUrl = env.WORKER_URL || DEFAULT_WORKER_URL;

    // Call Worker directly
    const workerResponse = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: prompt.trim() })
    });

    // Check if Worker responded successfully
    if (!workerResponse.ok) {
      const errorText = await workerResponse.text();
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Worker failed to process request',
          details: errorText
        }),
        {
          status: workerResponse.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Return Worker's response
    const data = await workerResponse.json();
    return new Response(
      JSON.stringify(data),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    console.error('Pages Function Error:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}

// Handle CORS preflight requests
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}

// Lightweight GET endpoint to check server-side EdenAI key presence
export async function onRequestGet(context: CloudflareContext) {
  const { env } = context;

  try {
    const serverEdenAIKey = env.EDENAI_API_KEY || env.VITE_EDENAI_API_KEY || '';
    const configured = Boolean(serverEdenAIKey && serverEdenAIKey.length > 0);
    const masked = configured ? `${serverEdenAIKey.slice(0, 4)}...${serverEdenAIKey.slice(-4)}` : null;

    return new Response(
      JSON.stringify({ success: true, configured, masked }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
}