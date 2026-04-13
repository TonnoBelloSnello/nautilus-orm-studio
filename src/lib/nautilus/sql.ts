import "server-only";

import { getSchemaConfig } from "@/lib/nautilus/schema";
import type { DatabaseProvider } from "@/lib/nautilus/types";

export interface SqlDialect {
  provider: DatabaseProvider;
  supportsReturning: boolean;
  parameter(index: number): string;
  quoteIdentifier(identifier: string): string;
  quoteStringLiteral(value: string): string;
  tableReference(tableName: string): string;
  textCast(expression: string): string;
}

export function createSqlDialect(provider: DatabaseProvider): SqlDialect {
  const quoteIdentifier = (identifier: string) =>
    provider === "mysql"
      ? `\`${identifier.replaceAll("`", "``")}\``
      : `"${identifier.replaceAll('"', '""')}"`;
  const quoteStringLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

  return {
    provider,
    supportsReturning: provider !== "mysql",
    parameter: (index: number) => (provider === "postgresql" ? `$${index}` : "?"),
    quoteIdentifier,
    quoteStringLiteral,
    tableReference: (tableName: string) => quoteIdentifier(tableName),
    textCast: (expression: string) =>
      provider === "mysql" ? `CAST(${expression} AS CHAR)` : `CAST(${expression} AS TEXT)`,
  };
}

let cachedDialect: SqlDialect | null = null;

export function getSqlDialect(): SqlDialect {
  if (cachedDialect) {
    return cachedDialect;
  }

  cachedDialect = createSqlDialect(getSchemaConfig().provider);
  return cachedDialect;
}
