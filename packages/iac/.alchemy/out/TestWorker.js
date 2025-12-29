// test/fixtures/test-worker.ts
var test_worker_default = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/echo") {
      const body = await request.text();
      return new Response(body, {
        headers: { "Content-Type": request.headers.get("Content-Type") || "text/plain" }
      });
    }
    return new Response("Hello from test worker!", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
export {
  test_worker_default as default
};
