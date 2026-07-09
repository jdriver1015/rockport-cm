import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton so builds and tooling don't require a live DATABASE_URL.
let _db: ReturnType<typeof createDb> | undefined;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  // Supabase pooled connections require prepare: false
  const client = postgres(url, { prepare: false });
  return drizzle(client, { schema });
}

export function db() {
  _db ??= createDb();
  return _db;
}

export * as schema from "./schema";
