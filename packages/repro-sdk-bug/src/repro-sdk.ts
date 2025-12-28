/**
 * Reproduction using the actual Cloudflare SDK
 *
 * This demonstrates that the SDK's create method fails because
 * it sends an array body (per OpenAPI spec) but the API rejects it.
 */

import Cloudflare from "cloudflare";

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

const client = new Cloudflare({ apiToken: API_TOKEN });

async function main() {
  console.log("Testing SDK's secretsStore.stores.create method\n");

  try {
    // This is how the SDK expects you to call create (per types)
    // The SDK sends: body: [{ name: "..." }] (array format)
    const result = await client.secretsStore.stores.create({
      account_id: ACCOUNT_ID!,
      body: [{ name: `sdk-test-${Date.now()}` }],
    });

    console.log("SDK create succeeded (unexpected):");
    for await (const store of result) {
      console.log("Created store:", store);
    }
  } catch (error) {
    console.log("SDK create failed (expected):");
    console.log(error);
    console.log("\nThis confirms the SDK/API mismatch.");
  }
}

main().catch(console.error);
