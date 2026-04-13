import "server-only";

import { NautilusRuntimeClient } from "@/lib/nautilus/runtime/client";
import { resolveSchemaPath } from "@/lib/nautilus/schema";

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

export async function getDb(): Promise<NautilusRuntimeClient> {
  if (!globalForNautilus.__nautilusDbPromise) {
    globalForNautilus.__nautilusDbPromise = (async () => {
      const db = new NautilusRuntimeClient(resolveSchemaPath());
      await db.connect();
      return db;
    })().catch((error) => {
      globalForNautilus.__nautilusDbPromise = undefined;
      throw error;
    });
  }

  return globalForNautilus.__nautilusDbPromise;
}

export async function getFirstDelegate(): Promise<NautilusDelegate> {
  return await getDb();
}
