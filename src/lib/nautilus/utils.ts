import type { ValueKind } from "@/lib/nautilus/types";

export function slugifyTableName(name: string): string {
  let slug = Array.from(name, (char) => (/[A-Za-z0-9]/.test(char) ? char.toLowerCase() : "_")).join("");
  while (slug.includes("__")) {
    slug = slug.replaceAll("__", "_");
  }
  return slug.replace(/^_+|_+$/g, "");
}

export function titleize(name: string): string {
  if (name.toUpperCase() === "ID") {
    return "ID";
  }

  const parts: string[] = [];
  let current = "";

  for (const char of name.replaceAll("-", "_")) {
    if (char === "_") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    if (/[A-Z]/.test(char) && current && !/[A-Z]/.test(current[current.length - 1] ?? "")) {
      parts.push(current);
      current = char;
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts
    .map((part) => (part.toLowerCase() === "id" ? "ID" : part[0]!.toUpperCase() + part.slice(1).toLowerCase()))
    .join(" ");
}

export function isAutoUpdateColumn(name: string): boolean {
  return name.replaceAll("_", "").toLowerCase() === "updatedat";
}

export function inferValueKind(udtName: string): ValueKind {
  const normalized = udtName.toLowerCase();

  if (normalized.startsWith("_") || normalized.endsWith("[]")) return "list";
  if (["json", "jsonb"].includes(normalized)) return "json";
  if (normalized === "uuid") return "uuid";
  if (["date"].includes(normalized)) return "date";
  if (["datetime", "timestamp", "timestamptz"].includes(normalized)) return "datetime";
  if (["time", "timetz"].includes(normalized)) return "time";
  if (["bool", "boolean", "tinyint(1)"].includes(normalized)) return "boolean";
  if (
    [
      "int",
      "integer",
      "int2",
      "int4",
      "int8",
      "serial",
      "serial4",
      "serial8",
      "smallint",
      "mediumint",
      "bigint",
      "tinyint",
    ].includes(normalized)
  ) return "int";
  if (["float", "float4", "float8", "double", "double precision", "real"].includes(normalized)) return "float";
  if (["numeric", "decimal", "money"].includes(normalized)) return "decimal";

  if (normalized.includes("int")) return "int";
  if (normalized.includes("double") || normalized.includes("float") || normalized.includes("real")) return "float";
  if (normalized.includes("decimal") || normalized.includes("numeric")) return "decimal";
  if (normalized.includes("bool")) return "boolean";
  if (normalized.includes("datetime") || normalized.includes("timestamp")) return "datetime";
  if (normalized === "date" || normalized.startsWith("date ")) return "date";
  if (normalized.startsWith("time")) return "time";
  if (normalized.includes("json")) return "json";

  return "string";
}

export function inferInputType(name: string, kind: ValueKind, hasEnumValues = false) {
  const normalizedName = name.toLowerCase();

  if (normalizedName.includes("email")) return "email" as const;
  if (hasEnumValues) return "select" as const;
  if (["int", "float", "decimal"].includes(kind)) return "number" as const;
  if (kind === "boolean") return "checkbox" as const;
  if (kind === "date") return "date" as const;
  if (kind === "datetime") return "datetime-local" as const;
  if (kind === "time") return "time" as const;
  return "text" as const;
}

export function userVisibleError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return "The database rejected the operation.";
}

export function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);

  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, sortObjectKeys(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}
