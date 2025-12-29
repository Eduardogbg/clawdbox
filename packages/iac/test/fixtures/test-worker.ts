// Simple test worker for integration testing
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/echo") {
      const body = await request.text();
      return new Response(body, {
        headers: { "Content-Type": request.headers.get("Content-Type") || "text/plain" },
      });
    }

    return new Response("Hello from test worker!", {
      headers: { "Content-Type": "text/plain" },
    });
  },
};
