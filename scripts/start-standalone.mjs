// Starts the production build from `output: "standalone"` outside Docker.
// Copies the static assets the standalone server expects next to it, loads .env
// (if present) and pins LOCAL_DATA_DIR to an absolute path, because the
// standalone server changes its working directory to .next/standalone.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });

const env = { ...process.env, NODE_ENV: "production" };
env.LOCAL_DATA_DIR = path.resolve(root, env.LOCAL_DATA_DIR || ".local");
const args = [...(existsSync(path.join(root, ".env")) ? [`--env-file-if-exists=${path.join(root, ".env")}`] : []), path.join(standalone, "server.js")];

const child = spawn(process.execPath, args, { stdio: "inherit", env });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
