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
