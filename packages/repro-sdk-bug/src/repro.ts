/**
 * Reproduction: Cloudflare SDK Secrets Store Create API Mismatch
 *
 * Issue: The SDK (generated from OpenAPI spec) expects an array body for
 * creating a secrets store, but the actual API rejects arrays and only
 * accepts single objects.
 *
 * OpenAPI spec (cloudflare/api-schemas):
 *   requestBody.content.application/json.schema.type: "array"
 *
 * SDK signature (cloudflare/cloudflare-typescript):
 *   body: Array<{ name: string }>
 *
 * Actual API behavior:
 *   - Array format: 400 invalid_json_body (code 1001)
 *   - Object format: 200 OK
 */

// Load .env file
const envFile = Bun.file(new URL("../.env", import.meta.url));
if (await envFile.exists()) {
  const text = await envFile.text();
  for (const line of text.split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
}

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars");
  process.exit(1);
}

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/secrets_store/stores`;
const headers = {
  Authorization: `Bearer ${API_TOKEN}`,
  "Content-Type": "application/json",
};

async function testCreate(label: string, body: unknown) {
  console.log(`\n=== ${label} ===`);
  console.log("Request body:", JSON.stringify(body));

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Response:", JSON.stringify(data, null, 2));

  return { ok: res.ok, data };
}

async function cleanup(storeId: string) {
  console.log(`\nCleaning up store: ${storeId}`);
  await fetch(`${BASE_URL}/${storeId}`, {
    method: "DELETE",
    headers,
  });
}

async function main() {
  console.log("Cloudflare Secrets Store Create API - SDK Mismatch Repro\n");
  console.log("OpenAPI spec says: body should be Array<{name: string}>");
  console.log("Actual API accepts: {name: string} (single object)\n");

  // Test 1: Array format (what SDK expects) - FAILS
  const arrayResult = await testCreate(
    "TEST 1: Array format (SDK expected format)",
    [{ name: `repro-array-${Date.now()}` }]
  );

  // Test 2: Single object format (workaround) - WORKS
  const objectResult = await testCreate(
    "TEST 2: Object format (workaround)",
    { name: `repro-object-${Date.now()}` }
  );

  // Cleanup if object test succeeded
  if (objectResult.ok && objectResult.data.result?.id) {
    await cleanup(objectResult.data.result.id);
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(`Array format (SDK):  ${arrayResult.ok ? "PASS" : "FAIL"}`);
  console.log(`Object format:       ${objectResult.ok ? "PASS" : "FAIL"}`);

  if (!arrayResult.ok && objectResult.ok) {
    console.log("\nBUG CONFIRMED: SDK format fails, workaround succeeds");
    console.log("\nReferences:");
    console.log("- OpenAPI spec: https://github.com/cloudflare/api-schemas/blob/main/openapi.yaml");
    console.log("- SDK source: https://github.com/cloudflare/cloudflare-typescript");
    process.exit(1);
  }
}

main().catch(console.error);
