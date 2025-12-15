export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GitHub API Proxy Route
    if (url.pathname.startsWith('/github')) {
      return handleGitHubRequest(request, env, corsHeaders);
    }

    // EdenAI OCR Proxy Routes
    if (url.pathname.startsWith('/ocr')) {
      return handleOCRRequest(request, env, corsHeaders);
    }

    // AI Chat Route (default)
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const prompt = body.prompt;
    const preferredModel = body.model; // Optional: allow frontend to specify model

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const errors = [];

    /* ================== 1️⃣ EDEN AI ================== */
    if (env.EDENAI_API_KEY) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch("https://api.edenai.run/v2/text/chat", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.EDENAI_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            providers: ["openai"],
            text: prompt
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const text = data?.openai?.generated_text;
          const status = data?.openai?.status;

          if (text && status !== "fail") {
            return new Response(
              JSON.stringify({
                success: true,
                text: text,
                provider: "edenai",
                model: "openai"
              }),
              { headers: corsHeaders }
            );
          }
          errors.push({ provider: "EdenAI", error: data?.openai?.error?.message || "Provider failed" });
        } else {
          errors.push({ provider: "EdenAI", status: res.status });
        }
      } catch (err) {
        errors.push({ provider: "EdenAI", error: err.message });
      }
    }

    /* ================== 2️⃣ GEMINI ================== */
    if (env.GEMINI_API_KEY) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            }),
            signal: controller.signal
          }
        );

        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

          if (text) {
            return new Response(
              JSON.stringify({
                success: true,
                text: text,
                provider: "gemini",
                model: "gemini-1.5-flash"
              }),
              { headers: corsHeaders }
            );
          }
        }
        const errorText = await res.text();
        errors.push({ provider: "Gemini", status: res.status, details: errorText });
      } catch (err) {
        errors.push({ provider: "Gemini", error: err.message });
      }
    }

    /* ================== 3️⃣ OPENROUTER (ENHANCED) ================== */
    if (env.OPENROUTER_API_KEY) {
      // Choose model based on request or use smart fallback
      const models = [
        preferredModel || "openai/gpt-4o-mini", // Fast & cheap
        "google/gemini-2.0-flash-exp:free",     // Free alternative
        "meta-llama/llama-3.1-8b-instruct:free", // Free backup
      ];

      for (const model of models) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://primoboost.com", // Optional: your site
              "X-Title": "PrimoBoost AI" // Optional: your app name
            },
            body: JSON.stringify({
              model: model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.7,
              max_tokens: 2000
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            const text = data?.choices?.[0]?.message?.content;

            if (text) {
              return new Response(
                JSON.stringify({
                  success: true,
                  text: text,
                  provider: "openrouter",
                  model: model
                }),
                { headers: corsHeaders }
              );
            }
          } else {
            const errorData = await res.json();
            errors.push({
              provider: "OpenRouter",
              model: model,
              status: res.status,
              error: errorData.error?.message
            });
          }
        } catch (err) {
          errors.push({ provider: "OpenRouter", model: model, error: err.message });
        }
      }
    }

    /* ================== ❌ ALL FAILED ================== */
    return new Response(
      JSON.stringify({
        success: false,
        error: "All AI providers failed",
        details: errors
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};

/**
 * Handle GitHub API Proxy Requests
 * Route: /github/*
 * Example: /github/search/repositories?q=react&sort=stars
 */
async function handleGitHubRequest(request, env, corsHeaders) {
  if (!env.GITHUB_API_TOKEN) {
    return new Response(
      JSON.stringify({ error: "GitHub API token not configured" }),
      { status: 500, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);
  const githubPath = url.pathname.replace(/^\/github/, '');
  const githubUrl = `https://api.github.com${githubPath}${url.search}`;

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `Bearer ${env.GITHUB_API_TOKEN}`,
      'User-Agent': 'PrimoBoost-AI'
    };

    const response = await fetch(githubUrl, {
      method: request.method,
      headers: headers
    });

    const data = await response.json();

    return new Response(
      JSON.stringify(data),
      {
        status: response.status,
        headers: corsHeaders
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "GitHub API request failed",
        details: error.message
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Handle EdenAI OCR Proxy Requests
 * Route: /ocr (POST) - Start OCR job
 * Route: /ocr/:jobId (GET) - Poll OCR job status
 */
async function handleOCRRequest(request, env, corsHeaders) {
  if (!env.EDENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "EdenAI API key not configured" }),
      { status: 500, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);

  // POST /ocr - Start OCR job
  if (request.method === 'POST' && url.pathname === '/ocr') {
    try {
      const body = await request.json();

      // Extract data from request
      const { file, fileName, fileType, provider = 'mistral' } = body;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "File data is required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Forward to EdenAI OCR API
      const edenResponse = await fetch('https://api.edenai.run/v2/ocr/ocr_async', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.EDENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          providers: [provider],
          file: file,
          file_name: fileName || 'resume.pdf',
          file_type: fileType || 'application/pdf'
        })
      });

      const result = await edenResponse.json();

      if (!edenResponse.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: result.error || 'OCR API failed',
            details: result
          }),
          { status: edenResponse.status, headers: corsHeaders }
        );
      }

      // Return job ID for polling
      return new Response(
        JSON.stringify({
          success: true,
          jobId: result.job_id,
          provider: provider
        }),
        { headers: corsHeaders }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "OCR request failed",
          details: error.message
        }),
        { status: 500, headers: corsHeaders }
      );
    }
  }

  // GET /ocr/:jobId - Poll OCR job status
  if (request.method === 'GET' && url.pathname.startsWith('/ocr/')) {
    try {
      const jobId = url.pathname.replace('/ocr/', '');

      if (!jobId) {
        return new Response(
          JSON.stringify({ error: "Job ID is required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Poll EdenAI for job status
      const edenResponse = await fetch(`https://api.edenai.run/v2/ocr/ocr_async/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.EDENAI_API_KEY}`
        }
      });

      const result = await edenResponse.json();

      if (!edenResponse.ok) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Failed to get OCR status',
            details: result
          }),
          { status: edenResponse.status, headers: corsHeaders }
        );
      }

      // Check if job is finished
      const providerResult = result[Object.keys(result)[0]]; // Get first provider result

      if (providerResult.status === 'success') {
        // Extract text from result
        const text = providerResult.text || '';

        return new Response(
          JSON.stringify({
            success: true,
            status: 'finished',
            text: text,
            confidence: providerResult.confidence || 85
          }),
          { headers: corsHeaders }
        );
      }

      if (providerResult.status === 'fail') {
        return new Response(
          JSON.stringify({
            success: false,
            status: 'failed',
            error: providerResult.error || 'OCR processing failed'
          }),
          { headers: corsHeaders }
        );
      }

      // Still processing
      return new Response(
        JSON.stringify({
          success: true,
          status: 'processing'
        }),
        { headers: corsHeaders }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to poll OCR status",
          details: error.message
        }),
        { status: 500, headers: corsHeaders }
      );
    }
  }

  // Method not allowed
  return new Response(
    JSON.stringify({ error: "Method not allowed for OCR route" }),
    { status: 405, headers: corsHeaders }
  );
}
