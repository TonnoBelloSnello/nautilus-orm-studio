import "server-only";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { DatabaseProvider } from "@/lib/nautilus/types";

interface NautilusSchemaConfig {
  provider: DatabaseProvider;
}

let cachedSchemaPath: string | null = null;
let cachedSchemaConfig: NautilusSchemaConfig | null = null;

export function parseDatasourceProvider(schemaSource: string): DatabaseProvider {
  const datasourceMatch = schemaSource.match(/\bdatasource\s+\w+\s*\{([\s\S]*?)\}/m);
  if (!datasourceMatch) {
    throw new Error("schema.nautilus is missing a datasource block.");
  }

  const providerMatch = datasourceMatch[1]?.match(/\bprovider\s*=\s*"([^"]+)"/);
  if (!providerMatch?.[1]) {
    throw new Error("schema.nautilus is missing datasource.provider.");
  }

  const provider = providerMatch[1].trim().toLowerCase();
  if (provider === "postgresql" || provider === "sqlite" || provider === "mysql") {
    return provider;
  }

  throw new Error(`Unsupported Nautilus datasource provider ${JSON.stringify(providerMatch[1])}.`);
}

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

export function resolveSchemaPath(): string {
  if (cachedSchemaPath) {
    return cachedSchemaPath;
  }

  const configuredPath = process.env.NAUTILUS_SCHEMA_PATH?.trim()
    || process.env.NAUTILUS_STUDIO_SCHEMA_PATH?.trim();

  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (!existsSync(resolved)) {
      throw new Error(`Configured Nautilus schema was not found at ${resolved}.`);
    }

    cachedSchemaPath = resolved;
    return resolved;
  }

  const discovered = findSchemaPathFromCwd();
  if (discovered) {
    cachedSchemaPath = discovered;
    return discovered;
  }

  throw new Error(
    "Unable to locate schema.nautilus. Set NAUTILUS_SCHEMA_PATH or place schema.nautilus in the host workspace.",
  );
}

export function getSchemaConfig(): NautilusSchemaConfig {
  if (cachedSchemaConfig) {
    return cachedSchemaConfig;
  }

  cachedSchemaConfig = {
    provider: parseDatasourceProvider(readFileSync(resolveSchemaPath(), "utf8")),
  };

  return cachedSchemaConfig;
}
