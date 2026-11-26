// Packs the Next.js `output: "standalone"` build into one archive for hosts that run Node apps
// through cPanel "Setup Node.js App" (Phusion Passenger), e.g. Namecheap shared hosting
// (docs/25-namecheap-deployment.md). Run after `npm run build`, ON LINUX x64 (WSL works): the
// bundle contains native modules (@node-rs/argon2) built for the machine that ran the build.
//
//   npm run build && npm run package:cpanel
//
// Output: dist/panel-standalone.tar.gz. Unpack it into the Node app's application root; the
// startup file is server.js. Passenger provides the port itself.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
if (process.platform !== "linux") {
  console.warn(`WARNING: built on ${process.platform}. Native modules will not load on a Linux server; build on Linux x64 (WSL) instead.`);
}

// The standalone server expects static assets and public/ next to it.
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
// Never ship local secrets or data.
for (const f of [".env", ".env.local", ".env.production", ".local"]) rmSync(path.join(standalone, f), { recursive: true, force: true });

mkdirSync(path.join(root, "dist"), { recursive: true });
const out = path.join(root, "dist", "panel-standalone.tar.gz");
execFileSync("tar", ["-czf", out, "-C", standalone, "."], { stdio: "inherit" });
console.log(`Packed ${path.relative(root, out)}. Upload it to the Node app root and unpack it there.`);
