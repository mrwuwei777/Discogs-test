import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No ISR/revalidation and no next/image usage in this app, so the default
// (in-memory) cache config is sufficient — no R2/Durable Objects needed.
export default defineCloudflareConfig();
