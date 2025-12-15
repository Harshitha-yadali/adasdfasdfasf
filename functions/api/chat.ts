export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.AI_WORKER) {
    return new Response(
      JSON.stringify({ error: "AI_WORKER binding not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const workerResponse = await env.AI_WORKER.fetch("http://internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  return new Response(await workerResponse.text(), {
    status: workerResponse.status,
    headers: { "Content-Type": "application/json" }
  });
}
