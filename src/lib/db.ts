import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { PoolConfig } from "mariadb";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single PrismaClient per process. In development, Next.js hot reload re-evaluates modules,
 * so the instance is cached on globalThis to avoid exhausting connections.
 *
 * Works with MySQL 8+ and MariaDB 10.4+ (Hostinger runs MariaDB). DATABASE_URL uses the
 * `mysql://USER:PASSWORD@HOST:PORT/DATABASE` form that the Prisma CLI also reads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function poolConfigFromUrl(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  if (url.protocol !== "mysql:" && url.protocol !== "mariadb:") {
    throw new Error("DATABASE_URL must start with mysql://");
  }
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    connectTimeout: 5_000,
    acquireTimeout: 10_000,
    idleTimeout: 30,
    ...(url.searchParams.get("ssl") === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
    // Keep PostgreSQL semantics the application was written for: READ COMMITTED (InnoDB
    // defaults to REPEATABLE READ with gap locks) and UTC for CURRENT_TIMESTAMP defaults.
    initSql: ["SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED", "SET time_zone = '+00:00'"],
  };
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaMariaDb(poolConfigFromUrl(connectionString)) });
}

function getClient(): PrismaClient {
  return (globalForPrisma.prisma ??= createClient());
}

/**
 * Created on first use, not on import: `next build` imports every route module while collecting
 * page data, and the build must not require DATABASE_URL or a reachable database.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/** InnoDB deadlock (1213) or lock wait timeout (1205): the transaction was rolled back and can be retried. */
export function isRetryableTransactionError(err: unknown): boolean {
  const e = err as { code?: string; meta?: { driverAdapterError?: unknown } } | null;
  if (e?.code === "P2034") return true;
  return /TransactionWriteConflict|Deadlock found|Lock wait timeout|\b1213\b|\b1205\b/.test(`${String(err)} ${String(e?.meta?.driverAdapterError ?? "")}`);
}

/** Runs a whole transaction again (up to `attempts` times) when InnoDB aborts it on a deadlock. */
export async function withTransactionRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isRetryableTransactionError(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.floor(Math.random() * 30)));
    }
  }
}

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
