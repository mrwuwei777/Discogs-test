// Minimal GitHub webhook receiver — no dependencies beyond Node's stdlib.
// Verifies the HMAC-SHA256 signature GitHub sends, and on a push to
// DEPLOY_BRANCH spawns deploy.sh.
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEBHOOK_PORT || 9001;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/webhook";
const SECRET = process.env.WEBHOOK_SECRET;
const BRANCH = process.env.DEPLOY_BRANCH || "claude/discogs-photo-collection-app-is1u4y";

if (!SECRET) {
  console.error("WEBHOOK_SECRET is not set — refusing to start");
  process.exit(1);
}

function verifySignature(payload, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const givenBuf = Buffer.from(signatureHeader);
  return expectedBuf.length === givenBuf.length && crypto.timingSafeEqual(expectedBuf, givenBuf);
}

function runDeploy() {
  console.log(`[webhook] ${new Date().toISOString()} triggering deploy`);
  const child = spawn(path.join(__dirname, "deploy.sh"), [], { stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[webhook] deploy.sh exited with code ${code}`);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
    res.writeHead(404);
    res.end();
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);

    if (!verifySignature(raw, req.headers["x-hub-signature-256"])) {
      res.writeHead(401);
      res.end("invalid signature");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400);
      res.end("bad payload");
      return;
    }

    res.writeHead(200);
    res.end("ok");

    const event = req.headers["x-github-event"];
    if (event === "push" && payload.ref === `refs/heads/${BRANCH}`) {
      runDeploy();
    } else {
      console.log(`[webhook] ignoring event=${event} ref=${payload.ref ?? "n/a"}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[webhook] listening on :${PORT}${WEBHOOK_PATH}, watching branch "${BRANCH}"`);
});
