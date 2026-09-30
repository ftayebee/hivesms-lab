#!/usr/bin/env node
/**
 * Local development PostgreSQL without Docker.
 *
 * Runs a real PostgreSQL server from the `embedded-postgres` npm package, storing data in
 * .local/pgdata. This is for local development and tests only. In production, point
 * DATABASE_URL at a managed PostgreSQL instance or the docker-compose service instead.
 *
 * Usage: npm run db:local          (keeps running until Ctrl+C)
 * Matching URL: postgresql://smsflow:smsflow@localhost:54329/smsflow?schema=public
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);
const dataDir = path.resolve(".local", "pgdata");
const databases = ["smsflow", "smsflow_test"];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "smsflow",
  password: "smsflow",
  port: PORT,
  persistent: true,
  // UTF-8 is required: Bangla text must be storable. (Windows defaults to WIN1252 otherwise.)
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (err) => console.error("[postgres]", err),
});

async function main() {
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) {
    console.log(`Initialising PostgreSQL data directory at ${dataDir}`);
    await pg.initialise();
  }
  await pg.start();

  const client = pg.getPgClient();
  await client.connect();
  for (const name of databases) {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
      console.log(`Created database ${name}`);
    }
  }
  await client.end();

  console.log(`PostgreSQL ready on port ${PORT}`);
  console.log(`  DATABASE_URL=postgresql://smsflow:smsflow@localhost:${PORT}/smsflow?schema=public`);
  console.log("Press Ctrl+C to stop.");
}

async function shutdown() {
  console.log("\nStopping PostgreSQL...");
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (err) => {
  console.error(err);
  try {
    await pg.stop();
  } catch {}
  process.exit(1);
});
