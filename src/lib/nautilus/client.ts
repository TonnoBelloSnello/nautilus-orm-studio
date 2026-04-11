import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";

import { NautilusRuntimeClient } from "@/lib/nautilus/runtime/client";

export interface NautilusDelegate {
  rawQuery(sql: string): Promise<Record<string, unknown>[]>;
  rawStmtQuery(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

declare global {
  var __nautilusDbPromise: Promise<NautilusRuntimeClient> | undefined;
}

const globalForNautilus = globalThis as typeof globalThis & {
  __nautilusDbPromise?: Promise<NautilusRuntimeClient>;
};

function findSchemaPathFromCwd(): string | null {
  let dir = process.cwd();

  while (true) {
    const candidate = path.join(dir, "schema.nautilus");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

function resolveSchemaPath(): string {
  const configuredPath = process.env.NAUTILUS_SCHEMA_PATH?.trim()
    || process.env.NAUTILUS_STUDIO_SCHEMA_PATH?.trim();

  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (!existsSync(resolved)) {
      throw new Error(`Configured Nautilus schema was not found at ${resolved}.`);
    }
    return resolved;
  }

  const discovered = findSchemaPathFromCwd();
  if (discovered) {
    return discovered;
  }

  throw new Error(
    "Unable to locate schema.nautilus. Set NAUTILUS_SCHEMA_PATH or place schema.nautilus in the host workspace.",
  );
}

async function createDb(): Promise<NautilusRuntimeClient> {
  const db = new NautilusRuntimeClient(resolveSchemaPath());
  await db.connect();
  return db;
}

export async function getDb(): Promise<NautilusRuntimeClient> {
  if (!globalForNautilus.__nautilusDbPromise) {
    globalForNautilus.__nautilusDbPromise = createDb().catch((error) => {
      globalForNautilus.__nautilusDbPromise = undefined;
      throw error;
    });
  }

  return globalForNautilus.__nautilusDbPromise;
}

export async function getFirstDelegate(): Promise<NautilusDelegate> {
  return await getDb();
}
