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
    
    // Normalize pathname to handle double slashes
    const pathname = url.pathname.replace(/\/+/g, '/');
    console.log('📍 Request path:', pathname);

    // GitHub API Proxy Route
    if (pathname.startsWith('/github')) {
      return handleGitHubRequest(request, env, corsHeaders);
    }

    // EdenAI OCR Proxy Route
    if (pathname === '/ocr' || pathname.startsWith('/ocr/')) {
      return handleOCRRequest(request, env, corsHeaders);
    }
// EdenAI OCR Proxy Route
if (pathname === '/ocr' || pathname.startsWith('/ocr/')) {
  return handleOCRRequest(request, env, corsHeaders);
}

// 👇 ADD THE NEW CODE HERE (after line 28, before line 30)
// GET /get-eden-key - Return EdenAI API key
if (pathname === '/get-eden-key' && request.method === 'GET') {
  return new Response(
    JSON.stringify({ apiKey: env.EDENAI_API_KEY }),
    { headers: corsHeaders }
  );
}

// AI Chat Route (default)
if (request.method !== "POST") {
  return new Response(

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
    const preferredModel = body.model;

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
            providers: ["openai/gpt-4o-mini"],
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

    /* ================== 3️⃣ OPENROUTER ================== */
    if (env.OPENROUTER_API_KEY) {
      const models = [
        preferredModel || "openai/gpt-4o-mini",
        "google/gemini-2.0-flash-exp:free",
        "meta-llama/llama-3.1-8b-instruct:free",
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
              "HTTP-Referer": "https://primoboost.com",
              "X-Title": "PrimoBoost AI"
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
 * Convert base64 string to Uint8Array
 */
function base64ToUint8Array(base64) {
  let cleanBase64 = base64;
  if (base64.includes(',')) {
    cleanBase64 = base64.split(',')[1];
  }

  const binaryString = atob(cleanBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Handle EdenAI OCR Proxy Requests
 * Based on official EdenAI OCR API documentation
 */
async function handleOCRRequest(request, env, corsHeaders) {
  if (!env.EDENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: "EdenAI API key not configured" }),
      { status: 500, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+/g, '/');

  // POST /ocr - OCR extraction
  if (request.method === 'POST' && pathname === '/ocr') {
    try {
      const body = await request.json();
      const { file, fileName, fileType } = body;

      if (!file) {
        return new Response(
          JSON.stringify({ error: "File data is required" }),
          { status: 400, headers: corsHeaders }
        );
      }

      // Convert base64 to binary
      let binaryData;
      try {
        binaryData = base64ToUint8Array(file);
      } catch (decodeError) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to decode base64 file data",
            details: decodeError.message
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      const mimeType = fileType || 'application/pdf';
      const resolvedFileName = fileName || 'resume.pdf';
      const blob = new Blob([binaryData], { type: mimeType });

      // ✅ Smart provider selection based on file type
      let provider;
      if (mimeType === 'application/pdf') {
        // PDF files: use Google (best for PDFs)
        provider = 'google';
      } else if (mimeType.startsWith('image/')) {
        // Image files: use Mistral (supports images only)
        provider = 'mistral';
      } else {
        // Default fallback
        provider = 'google';
      }

      // Build FormData according to EdenAI docs
      const formData = new FormData();
      formData.append('providers', provider); // String format (per docs)
      formData.append('file', blob, resolvedFileName);
      formData.append('language', 'en'); // Optional but helpful

      console.log('🔍 Calling EdenAI OCR with provider:', provider, 'for file type:', mimeType);

      // Call EdenAI OCR endpoint
      const edenResponse = await fetch('https://api.edenai.run/v2/ocr/ocr', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.EDENAI_API_KEY}`
        },
        body: formData
      });

      const result = await edenResponse.json();
      console.log('📊 EdenAI Response Status:', edenResponse.status);

      if (!edenResponse.ok) {
        console.error('❌ EdenAI Error:', result);
        return new Response(
          JSON.stringify({
            success: false,
            error: result.error || 'OCR API failed',
            details: result,
            status: edenResponse.status
          }),
          { status: edenResponse.status, headers: corsHeaders }
        );
      }

      // Extract text from provider result
      const providerResult = result[provider];

      if (!providerResult) {
        console.error('❌ No result from provider:', provider);
        return new Response(
          JSON.stringify({
            success: false,
            error: `No OCR result from provider: ${provider}`,
            details: result,
            availableProviders: Object.keys(result)
          }),
          { status: 500, headers: corsHeaders }
        );
      }

      if (providerResult.status === 'fail') {
        console.error('❌ Provider failed:', providerResult);
        return new Response(
          JSON.stringify({
            success: false,
            error: providerResult.error?.message || 'OCR processing failed',
            details: providerResult
          }),
          { status: 500, headers: corsHeaders }
        );
      }

      const extractedText = providerResult.text || '';

      if (!extractedText || extractedText.length < 20) {
        console.warn('⚠️ Insufficient text:', extractedText.length, 'chars');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'OCR extracted insufficient text',
            details: { 
              textLength: extractedText.length,
              provider: provider,
              status: providerResult.status
            }
          }),
          { status: 400, headers: corsHeaders }
        );
      }

      console.log('✅ OCR Success:', extractedText.length, 'characters');

      return new Response(
        JSON.stringify({
          success: true,
          text: extractedText,
          provider: provider,
          confidence: 85
        }),
        { headers: corsHeaders }
      );

    } catch (error) {
      console.error('❌ OCR Handler Error:', error);
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

  // Method not allowed
  return new Response(
    JSON.stringify({ error: "Method not allowed for OCR route" }),
    { status: 405, headers: corsHeaders }
  );
}