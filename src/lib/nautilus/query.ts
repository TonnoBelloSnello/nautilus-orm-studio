import "server-only";

import { getFirstDelegate } from "@/lib/nautilus/client";
import type { RawQueryView } from "@/lib/nautilus/types";
import { userVisibleError } from "@/lib/nautilus/utils";

function normalizeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row)));
}

function collectColumns(rows: Record<string, unknown>[]): string[] {
  return Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
}

export async function runRawQuery(
  sql: string,
): Promise<RawQueryView> {
  const delegate = await getFirstDelegate();
  const normalizedSql = sql.trim();

  if (!normalizedSql) {
    return {
      sql: normalizedSql,
      rows: [],
      columns: [],
      rowCount: 0,
      submitted: true,
      errorMessage: "Enter a SQL query.",
    };
  }

  try {
    const rows = normalizeRows(await delegate.rawQuery(normalizedSql));
    return {
      sql: normalizedSql,
      rows,
      columns: collectColumns(rows),
      rowCount: rows.length,
      submitted: true,
      errorMessage: null,
    };
  } catch (error) {
    return {
      sql: normalizedSql,
      rows: [],
      columns: [],
      rowCount: 0,
      submitted: true,
      errorMessage: userVisibleError(error),
    };
  }
}
