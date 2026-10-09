#!/usr/bin/env node
/**
 * Copies sender-ID documents stored by the Next.js app (local storage driver) into the Laravel
 * document disk, before LARAVEL_FEATURES gets `senderIds` (or `admin`, which also downloads them).
 *
 *   node scripts/copy-sender-id-documents.mjs --from <LOCAL_DATA_DIR>/storage --to backend/storage/app/private          # dry run
 *   node scripts/copy-sender-id-documents.mjs --from <LOCAL_DATA_DIR>/storage --to backend/storage/app/private --apply  # copy
 *
 * Both apps use the same keys (orgs/<organizationId>/sender-ids/<uuid>.<ext>), so the relative path
 * is kept as is. Safe by construction:
 *   - only files under orgs/<id>/sender-ids/ are considered;
 *   - existing target files are never overwritten (same size → "already there", else reported);
 *   - nothing is ever deleted — the old files stay in place for rollback.
 * With S3 storage nothing needs copying: point Laravel's DOCUMENTS_DISK at the same bucket.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const from = arg("--from");
const to = arg("--to");
const apply = args.includes("--apply");
if (!from || !to) {
  console.error("Usage: node scripts/copy-sender-id-documents.mjs --from <node storage dir> --to <laravel disk root> [--apply]");
  process.exit(2);
}
const src = path.resolve(from);
const dst = path.resolve(to);
const orgs = path.join(src, "orgs");
if (!existsSync(orgs)) {
  console.log(`No ${orgs} directory: nothing to copy.`);
  process.exit(0);
}

const stats = { found: 0, copied: 0, present: 0, conflicts: 0 };
for (const org of readdirSync(orgs)) {
  const dir = path.join(orgs, org, "sender-ids");
  if (!/^[0-9a-f-]{36}$/i.test(org) || !existsSync(dir) || !statSync(dir).isDirectory()) continue;
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (!statSync(file).isFile() || !/^[0-9a-f-]{36}\.(pdf|png|jpe?g)$/i.test(name)) continue;
    stats.found++;
    const key = path.join("orgs", org, "sender-ids", name);
    const target = path.join(dst, key);
    if (existsSync(target)) {
      if (statSync(target).size === statSync(file).size) stats.present++;
      else {
        stats.conflicts++;
        console.warn(`CONFLICT (left untouched): ${key} exists with a different size`);
      }
      continue;
    }
    if (apply) {
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(file, target);
    }
    stats.copied++;
    console.log(`${apply ? "copied" : "would copy"}: ${key}`);
  }
}
console.log(`\n${apply ? "Done" : "Dry run"}: ${stats.found} documents found, ${stats.copied} ${apply ? "copied" : "to copy"}, ${stats.present} already present, ${stats.conflicts} conflicts. Nothing was deleted.`);
if (stats.conflicts) process.exit(1);
