import "server-only";
import { cache } from "react";

import { getFirstDelegate } from "@/lib/nautilus/client";
import type {
  ColumnDefinition,
  RelationDefinition,
  TableDefinition,
  TableRegistryData,
} from "@/lib/nautilus/types";
import {
  inferInputType,
  inferValueKind,
  isAutoUpdateColumn,
  slugifyTableName,
  titleize,
} from "@/lib/nautilus/utils";

interface CatalogColumnRow {
  column_name: string;
  udt_name: string;
  is_nullable: string;
  column_default: unknown;
  generation_expression: unknown;
}

function normalizeName(name: string): string {
  return name.toLowerCase();
}

async function loadEnumValues(): Promise<Map<string, string[]>> {
  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(
    `
      SELECT
        t.typname AS udt_name,
        e.enumlabel AS enum_value
      FROM pg_type t
      JOIN pg_enum e
        ON t.oid = e.enumtypid
      JOIN pg_namespace n
        ON n.oid = t.typnamespace
      WHERE n.nspname = $1
      ORDER BY t.typname, e.enumsortorder
    `,
    ["public"],
  );

  const valuesByType = new Map<string, string[]>();

  for (const row of rows) {
    const udtName = String(row.udt_name);
    const enumValue = String(row.enum_value);
    const values = valuesByType.get(udtName) ?? [];
    values.push(enumValue);
    valuesByType.set(udtName, values);
  }

  return valuesByType;
}

async function loadForeignKeys(): Promise<Map<string, RelationDefinition>> {
  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(
    `
      SELECT
        kcu.table_name AS source_table_name,
        kcu.column_name AS source_column_name,
        ccu.table_name AS target_table_name,
        ccu.column_name AS target_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
      ORDER BY kcu.table_name, kcu.column_name
    `,
    ["public"],
  );

  const relations = new Map<string, RelationDefinition>();

  for (const row of rows) {
    const sourceTableName = String(row.source_table_name);
    const sourceColumnName = String(row.source_column_name);
    const targetTableName = String(row.target_table_name);
    const targetColumnName = String(row.target_column_name);
    const displayName = titleize(targetTableName);

    relations.set(`${normalizeName(sourceTableName)}:${normalizeName(sourceColumnName)}`, {
      targetTableName,
      targetTableSlug: slugifyTableName(targetTableName),
      targetColumn: targetColumnName,
      targetDisplayName: displayName,
      displayName,
    });
  }

  return relations;
}

async function loadPrimaryKeyColumns(tableName: string): Promise<string[]> {
  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position
    `,
    ["public", tableName],
  );

  return rows.map((row) => String(row.column_name));
}

async function loadColumns(
  tableName: string,
  enumValuesByType: Map<string, string[]>,
  foreignKeys: Map<string, RelationDefinition>,
) {
  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(
    `
      SELECT
        column_name,
        udt_name,
        is_nullable,
        column_default,
        generation_expression
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
    `,
    ["public", tableName],
  );

  return (rows as unknown as CatalogColumnRow[]).map((row) => {
    const dbName = String(row.column_name);
    const udtName = String(row.udt_name);
    const nullable = String(row.is_nullable).toUpperCase() === "YES";
    const hasDefault = row.column_default !== null && row.column_default !== undefined;
    const generated = row.generation_expression !== null && row.generation_expression !== "";
    const kind = inferValueKind(udtName);
    const enumValues = enumValuesByType.get(udtName) ?? [];
    const autoUpdate = isAutoUpdateColumn(dbName);

    const column: ColumnDefinition = {
      name: dbName,
      dbName,
      label: titleize(dbName),
      kind,
      enumValues,
      required: !nullable && !hasDefault && !generated && !autoUpdate,
      editable: !generated,
      nullable,
      hasDefault,
      autoUpdate,
      inputType: inferInputType(dbName, kind, enumValues.length > 0),
      relation: foreignKeys.get(`${normalizeName(tableName)}:${normalizeName(dbName)}`) ?? null,
    };

    return column;
  });
}

function resolveColumns(
  columns: ColumnDefinition[],
  primaryKeyColumn: string | null,
): ColumnDefinition[] {
  return columns.map((column) => {
    return {
      ...column,
      required:
        column.required && !(column.hasDefault || column.autoUpdate || column.dbName === primaryKeyColumn),
    };
  });
}

export const loadRegistry = cache(async (): Promise<TableRegistryData> => {  
  const delegate = await getFirstDelegate();
  const [tables, enumValuesByType, foreignKeys] = await Promise.all([
    delegate.rawStmtQuery(
      `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_type = 'BASE TABLE'
          AND table_name NOT LIKE '_nautilus_%'
        ORDER BY table_name
      `,
      ["public"],
    ),

    loadEnumValues(),
    loadForeignKeys(),
  ]);
  
  const resolvedTables: TableDefinition[] = [];
  const aliases = new Map<string, string>();

  const tablePromises = tables.map(async (row) => {
    const tableName = String(row.table_name);
    
    const [primaryKeyColumns, columns] = await Promise.all([
      loadPrimaryKeyColumns(tableName),
      loadColumns(tableName, enumValuesByType, foreignKeys),
    ]);

    const primaryKeyColumn = primaryKeyColumns.length === 1 ? primaryKeyColumns[0] : null;

    const resolvedColumns = resolveColumns(columns, primaryKeyColumn);
    const primaryKey = primaryKeyColumn;
    const slug = slugifyTableName(tableName);
    const displayName = titleize(tableName);
    const supportsCrud = Boolean(primaryKeyColumn && primaryKey);

    const table: TableDefinition = {
      tableName,
      slug,
      primaryKey,
      primaryKeyColumn,
      columns: resolvedColumns,
      supportsCrud,
      title: displayName,
      displayName,
    };

    return table;
  });

  const resolvedTablesData = await Promise.all(tablePromises);

  for (const table of resolvedTablesData) {
    resolvedTables.push(table);
    aliases.set(table.slug.toLowerCase(), table.slug);
    aliases.set(table.tableName.toLowerCase(), table.slug);
  }

  return {
    tables: resolvedTables,
    aliases,
  };
});

export const getTable = cache(async (name: string): Promise<TableDefinition | null> => {
  const registry = await loadRegistry();
  const slug = registry.aliases.get(name.toLowerCase());
  if (!slug) {
    return null;
  }
  return registry.tables.find((table) => table.slug === slug) ?? null;
});
