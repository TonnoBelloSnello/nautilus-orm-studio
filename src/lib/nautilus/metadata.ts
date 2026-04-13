import "server-only";
import { cache } from "react";

import { getFirstDelegate } from "@/lib/nautilus/client";
import { getSchemaConfig } from "@/lib/nautilus/schema";
import { getSqlDialect } from "@/lib/nautilus/sql";
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
  extra?: unknown;
  column_type?: unknown;
}

function parseMysqlEnumValues(columnType: string): string[] {
  if (!columnType.toLowerCase().startsWith("enum(")) {
    return [];
  }

  return Array.from(columnType.matchAll(/'((?:[^'\\]|\\.|'')*)'/g), (match) =>
    match[1]!.replaceAll("\\'", "'").replaceAll("\\\\", "\\").replaceAll("''", "'"),
  );
}

async function listTableNames(provider: ReturnType<typeof getSchemaConfig>["provider"]): Promise<string[]> {
  const delegate = await getFirstDelegate();

  switch (provider) {
    case "postgresql": {
      const rows = await delegate.rawStmtQuery(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
          AND table_name NOT LIKE '_nautilus_%'
        ORDER BY table_name
      `);

      return rows.map((row) => String(row.table_name));
    }
    case "mysql": {
      const rows = await delegate.rawStmtQuery(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_type = 'BASE TABLE'
          AND table_name NOT LIKE '_nautilus_%'
        ORDER BY table_name
      `);

      return rows.map((row) => String(row.table_name));
    }
    case "sqlite": {
      const rows = await delegate.rawStmtQuery(`
        SELECT name AS table_name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_nautilus_%'
        ORDER BY name
      `);

      return rows.map((row) => String(row.table_name));
    }
  }
}

async function loadEnumValues(
  provider: ReturnType<typeof getSchemaConfig>["provider"],
): Promise<Map<string, string[]>> {
  if (provider !== "postgresql") {
    return new Map();
  }

  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(`
    SELECT
      t.typname AS udt_name,
      e.enumlabel AS enum_value
    FROM pg_type t
    JOIN pg_enum e
      ON t.oid = e.enumtypid
    JOIN pg_namespace n
      ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema()
    ORDER BY t.typname, e.enumsortorder
  `);

  const valuesByType = new Map<string, string[]>();

  for (const row of rows) {
    const udtName = String(row.udt_name).toLowerCase();
    const enumValue = String(row.enum_value);
    const values = valuesByType.get(udtName) ?? [];
    values.push(enumValue);
    valuesByType.set(udtName, values);
  }

  return valuesByType;
}

async function loadForeignKeys(
  provider: ReturnType<typeof getSchemaConfig>["provider"],
  tableNames: string[],
): Promise<Map<string, RelationDefinition>> {
  const delegate = await getFirstDelegate();
  const rows =
    provider === "postgresql"
      ? await delegate.rawStmtQuery(`
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
            AND tc.table_schema = current_schema()
          ORDER BY kcu.table_name, kcu.column_name
        `)
      : provider === "mysql"
        ? await delegate.rawStmtQuery(`
            SELECT
              table_name AS source_table_name,
              column_name AS source_column_name,
              referenced_table_name AS target_table_name,
              referenced_column_name AS target_column_name
            FROM information_schema.key_column_usage
            WHERE table_schema = DATABASE()
              AND referenced_table_schema = DATABASE()
              AND referenced_table_name IS NOT NULL
            ORDER BY table_name, ordinal_position
          `)
        : (
            await Promise.all(
              tableNames.map(async (tableName) =>
                delegate.rawStmtQuery(`
                  SELECT
                    ${getSqlDialect().quoteStringLiteral(tableName)} AS source_table_name,
                    "from" AS source_column_name,
                    "table" AS target_table_name,
                    COALESCE("to", '') AS target_column_name
                  FROM pragma_foreign_key_list(${getSqlDialect().quoteStringLiteral(tableName)})
                  ORDER BY id, seq
                `),
              ),
            )
          ).flat();

  const relations = new Map<string, RelationDefinition>();

  for (const row of rows) {
    const sourceTableName = String(row.source_table_name);
    const sourceColumnName = String(row.source_column_name);
    const targetTableName = String(row.target_table_name);
    const targetColumnName = String(row.target_column_name ?? "");
    const displayName = titleize(targetTableName);

    relations.set(`${sourceTableName.toLowerCase()}:${sourceColumnName.toLowerCase()}`, {
      targetTableName,
      targetTableSlug: slugifyTableName(targetTableName),
      targetColumn: targetColumnName,
      targetDisplayName: displayName,
      displayName,
    });
  }

  return relations;
}

async function loadPrimaryKeyColumns(
  provider: ReturnType<typeof getSchemaConfig>["provider"],
  tableName: string,
): Promise<string[]> {
  const delegate = await getFirstDelegate();

  switch (provider) {
    case "postgresql": {
      const rows = await delegate.rawStmtQuery(
        `
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = $1
          ORDER BY kcu.ordinal_position
        `,
        [tableName],
      );

      return rows.map((row) => String(row.column_name));
    }
    case "mysql": {
      const rows = await delegate.rawStmtQuery(
        `
          SELECT column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = DATABASE()
            AND table_name = ?
            AND constraint_name = 'PRIMARY'
          ORDER BY ordinal_position
        `,
        [tableName],
      );

      return rows.map((row) => String(row.column_name));
    }
    case "sqlite": {
      const rows = await delegate.rawStmtQuery(`
        SELECT name AS column_name
        FROM pragma_table_xinfo(${getSqlDialect().quoteStringLiteral(tableName)})
        WHERE pk > 0
        ORDER BY pk
      `);

      return rows.map((row) => String(row.column_name));
    }
  }
}

async function loadColumns(
  provider: ReturnType<typeof getSchemaConfig>["provider"],
  tableName: string,
  enumValuesByType: Map<string, string[]>,
  foreignKeys: Map<string, RelationDefinition>,
) {
  const delegate = await getFirstDelegate();
  const rows =
    provider === "postgresql"
      ? await delegate.rawStmtQuery(
          `
            SELECT
              column_name,
              udt_name,
              is_nullable,
              column_default,
              generation_expression
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = $1
            ORDER BY ordinal_position
          `,
          [tableName],
        )
      : provider === "mysql"
        ? await delegate.rawStmtQuery(
            `
              SELECT
                column_name,
                column_type AS udt_name,
                is_nullable,
                column_default,
                generation_expression,
                extra,
                column_type
              FROM information_schema.columns
              WHERE table_schema = DATABASE()
                AND table_name = ?
              ORDER BY ordinal_position
            `,
            [tableName],
          )
        : await delegate.rawStmtQuery(`
            SELECT
              name AS column_name,
              type AS udt_name,
              CASE WHEN "notnull" = 0 THEN 'YES' ELSE 'NO' END AS is_nullable,
              dflt_value AS column_default,
              CASE WHEN hidden = 0 THEN NULL ELSE hidden END AS generation_expression
            FROM pragma_table_xinfo(${getSqlDialect().quoteStringLiteral(tableName)})
            ORDER BY cid
          `);

  return (rows as unknown as CatalogColumnRow[]).map((row) => {
    const dbName = String(row.column_name);
    const udtName = String(row.udt_name ?? "");
    const extra = String(row.extra ?? "").toLowerCase();
    const nullable = String(row.is_nullable).toUpperCase() === "YES";
    const hasDefault =
      row.column_default !== null
      && row.column_default !== undefined
      || extra.includes("auto_increment");
    const generated =
      row.generation_expression !== null
      && row.generation_expression !== undefined
      && row.generation_expression !== ""
      || extra.includes("generated");
    const kind = inferValueKind(udtName);
    const enumValues =
      provider === "mysql"
        ? parseMysqlEnumValues(String(row.column_type ?? row.udt_name ?? ""))
        : enumValuesByType.get(udtName.toLowerCase()) ?? [];
    const autoUpdate = isAutoUpdateColumn(dbName);

    const column: ColumnDefinition = {
      name: dbName,
      dbName,
      nativeType: udtName,
      label: titleize(dbName),
      kind,
      enumValues,
      required: !nullable && !hasDefault && !generated && !autoUpdate,
      editable: !generated,
      nullable,
      hasDefault,
      autoUpdate,
      inputType: inferInputType(dbName, kind, enumValues.length > 0),
      relation: foreignKeys.get(`${tableName.toLowerCase()}:${dbName.toLowerCase()}`) ?? null,
    };

    return column;
  });
}

export const loadRegistry = cache(async (): Promise<TableRegistryData> => {
  const provider = getSchemaConfig().provider;
  const tableNames = await listTableNames(provider);
  const [enumValuesByType, foreignKeys] = await Promise.all([
    loadEnumValues(provider),
    loadForeignKeys(provider, tableNames),
  ]);

  const resolvedTables: TableDefinition[] = [];
  const aliases = new Map<string, string>();

  const tablePromises = tableNames.map(async (tableName) => {
    const [primaryKeyColumns, columns] = await Promise.all([
      loadPrimaryKeyColumns(provider, tableName),
      loadColumns(provider, tableName, enumValuesByType, foreignKeys),
    ]);

    const primaryKeyColumn = primaryKeyColumns.length === 1 ? primaryKeyColumns[0] : null;
    const primaryKey = primaryKeyColumn;
    const slug = slugifyTableName(tableName);
    const displayName = titleize(tableName);
    const supportsCrud = Boolean(primaryKeyColumn && primaryKey);

    const table: TableDefinition = {
      tableName,
      slug,
      primaryKey,
      primaryKeyColumn,
      columns: columns.map((column) => ({
        ...column,
        required:
          column.required && !(
            column.hasDefault
            || column.autoUpdate
            || column.dbName === primaryKeyColumn
          ),
      })),
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
