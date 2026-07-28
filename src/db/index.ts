import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Persist the drizzle singleton on globalThis so Next.js dev-mode hot reloads
// don't spawn a fresh postgres client each save — that leaks connections until
// Supabase's pool caps out at 200 and every request starts failing.
declare global {
  var __rockportDb: ReturnType<typeof createDb> | undefined;
}

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  // Supabase pooled connections require prepare: false and TLS. `max` caps
  // per-client connections; idle/lifetime timeouts release them so leaks age
  // out instead of piling up.
  const client = postgres(url, {
    prepare: false,
    ssl: "require",
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  });
  return drizzle(client, { schema });
}

export function db() {
  globalThis.__rockportDb ??= createDb();
  return globalThis.__rockportDb;
}

export * as schema from "./schema";
