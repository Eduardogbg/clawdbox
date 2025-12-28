/**
 * Test using the FIXED Cloudflare SDK
 *
 * This demonstrates that the fixed SDK's create method works correctly
 * with the new single-object body format.
 */

// Import from the local fixed SDK (built)
import Cloudflare from "cloudflare-fixed";

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

async function cleanup(storeId: string) {
  console.log(`\nCleaning up store: ${storeId}`);
  await client.secretsStore.stores.delete(storeId, { account_id: ACCOUNT_ID! });
}

async function main() {
  console.log("Testing FIXED SDK's secretsStore.stores.create method\n");

  try {
    // With the fix, we pass name directly (not in a body array)
    const store = await client.secretsStore.stores.create({
      account_id: ACCOUNT_ID!,
      name: `fixed-sdk-test-${Date.now()}`,
    });

    console.log("SDK create succeeded!");
    console.log("Created store:", store);

    await cleanup(store.id);
    console.log("\nFIX VERIFIED: SDK now works correctly!");
  } catch (error) {
    console.log("SDK create failed (unexpected with fix):");
    console.log(error);
    process.exit(1);
  }
}

main().catch(console.error);
