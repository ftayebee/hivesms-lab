#!/usr/bin/env node
/**
 * Inventory of direct database access in the Next.js app (Prisma) and of server actions / route
 * handlers, for the Laravel cutover docs (docs/14-…, docs/15-…).
 *
 *   node scripts/audit-prisma-usage.mjs            # markdown summary
 *   node scripts/audit-prisma-usage.mjs --json     # machine-readable
 *
 * Read-only: it only reads files. Counts are regex-based (good enough for an inventory; every
 * file is listed so a reviewer can check it).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const SCAN = ["src", "scripts", "tests", "prisma"];
const SKIP = new Set(["node_modules", "generated", ".next"]);

const OPS =
  "findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow|create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy";
// db.<model>.<op>(  ·  tx.<model>.<op>(  ·  prisma.<model>.<op>(  ·  client.<model>.<op>(
const MODEL_CALL = new RegExp(`\\b(db|tx|prisma|client)\\.([a-zA-Z]+)\\.(${OPS})\\(`, "g");
const RAW_CALL = /\b(db|tx|prisma|client)\.\$(transaction|queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe)\b/g;
const PRISMA_IMPORT = /from\s+["'](@\/lib\/db|@\/generated\/prisma[^"']*|@prisma\/[^"']+|\.\.?\/[^"']*generated\/prisma[^"']*|\.\.?\/[^"']*lib\/db)["']/g;
const FUNC = /^export\s+(?:async\s+)?function\s+(\w+)|^export\s+const\s+(\w+)\s*=\s*(?:cache\()?(?:async)?/gm;
const ROUTE_EXPORT = /^export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN) {
  try {
    walk(join(ROOT, d), files);
  } catch {
    /* directory may not exist */
  }
}

const rows = [];
for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (rel === "scripts/audit-prisma-usage.mjs") continue;
  const src = readFileSync(abs, "utf8");
  const modelCalls = [...src.matchAll(MODEL_CALL)].map((m) => `${m[2]}.${m[3]}`);
  const rawCalls = [...src.matchAll(RAW_CALL)].map((m) => `$${m[2]}`);
  const imports = [...new Set([...src.matchAll(PRISMA_IMPORT)].map((m) => m[1]))];
  const isServerActionFile = /^\s*["']use server["']/.test(src);
  const exported = [...src.matchAll(FUNC)].map((m) => m[1] ?? m[2]).filter(Boolean);
  const routeMethods = rel.endsWith("/route.ts") ? [...src.matchAll(ROUTE_EXPORT)].map((m) => m[1]) : [];
  const usesLaravel = /from\s+["']@\/lib\/laravel-api["']|from\s+["']@\/lib\/laravel\//.test(src);
  if (!modelCalls.length && !rawCalls.length && !imports.length && !isServerActionFile && !routeMethods.length && !usesLaravel) continue;
  rows.push({
    file: rel,
    area: rel.split("/").slice(0, rel.startsWith("src/") ? 3 : 2).join("/"),
    prismaCalls: modelCalls.length + rawCalls.length,
    modelCalls,
    rawCalls,
    imports,
    serverActions: isServerActionFile ? exported : [],
    exportedFunctions: exported.length,
    routeMethods,
    usesLaravel,
  });
}

rows.sort((a, b) => a.file.localeCompare(b.file));
const sum = (f) => rows.reduce((n, r) => n + f(r), 0);
const totals = {
  filesWithPrismaCalls: rows.filter((r) => r.prismaCalls > 0).length,
  filesImportingPrisma: rows.filter((r) => r.imports.length > 0).length,
  prismaCalls: sum((r) => r.prismaCalls),
  prismaCallsInSrc: sum((r) => (r.file.startsWith("src/") ? r.prismaCalls : 0)),
  prismaCallsInTestsScriptsSeed: sum((r) => (r.file.startsWith("src/") ? 0 : r.prismaCalls)),
  functionsInPrismaFiles: sum((r) => (r.prismaCalls > 0 ? r.exportedFunctions : 0)),
  serverActionFiles: rows.filter((r) => r.serverActions.length).length,
  serverActions: sum((r) => r.serverActions.length),
  routeHandlers: rows.filter((r) => r.routeMethods.length).length,
  filesUsingLaravelClient: rows.filter((r) => r.usesLaravel).length,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ totals, rows }, null, 2));
} else {
  console.log("## Totals\n");
  for (const [k, v] of Object.entries(totals)) console.log(`- ${k}: ${v}`);
  console.log("\n## Files\n\n| File | Prisma calls | Imports | Server actions | Route | Laravel |\n|---|---:|---|---|---|---|");
  for (const r of rows) {
    console.log(
      `| ${r.file} | ${r.prismaCalls} | ${r.imports.join(", ")} | ${r.serverActions.join(", ")} | ${r.routeMethods.join(", ")} | ${r.usesLaravel ? "yes" : ""} |`,
    );
  }
}
