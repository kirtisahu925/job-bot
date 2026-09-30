import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The commit this build came from: Cloudflare's build variable, else git, so a deploy can be checked. */
function commit(): string {
  const fromCi = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const buildStamp = (): Plugin => ({
  name: "fairsheet-build-stamp",
  transformIndexHtml: (html) => html.replace("</head>", `  <meta name="fairsheet-build" content="${commit()}" />\n  </head>`),
});

export default defineConfig({
  plugins: [react(), buildStamp()],
});
