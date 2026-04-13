import "server-only";

import { getDb, getFirstDelegate, type NautilusDelegate } from "@/lib/nautilus/client";
import {
  findFilterColumn,
  formatFilterSearchValue,
  getFilterSqlOperator,
  isAdvancedFilter,
  normalizeFilterOperator,
  parseFilterInput,
  splitFilterExpression,
} from "@/lib/nautilus/filter";
import { getTable, loadRegistry } from "@/lib/nautilus/metadata";
import { normalizeValue } from "@/lib/nautilus/presentation";
import type {
  ColumnDefinition,
  InlineEditEntry,
  InlineEditOperation,
  TableDefinition,
  TableView,
} from "@/lib/nautilus/types";
import { getSqlDialect } from "@/lib/nautilus/sql";
import { userVisibleError } from "@/lib/nautilus/utils";

export class AdminError extends Error {}
export class TableNotFoundError extends AdminError {}
export class UnsupportedTableError extends AdminError {}
export class RecordNotFoundError extends AdminError {}
export class InvalidFieldValueError extends AdminError {}
export class PartialInlineApplyError extends AdminError {
  constructor(message: string, readonly appliedCount: number) {
    super(message);
  }
}

function quoteIdentifier(identifier: string): string {
  return getSqlDialect().quoteIdentifier(identifier);
}

function tableReference(tableName: string): string {
  return getSqlDialect().tableReference(tableName);
}

function parameterPlaceholder(index: number): string {
  return getSqlDialect().parameter(index);
}

function isPostgresTextLikeColumn(column: ColumnDefinition): boolean {
  if (getSqlDialect().provider !== "postgresql") {
    return false;
  }

  if (column.enumValues.length > 0) {
    return false;
  }

  return ["text", "varchar", "bpchar", "citext", "name"].includes(column.nativeType.toLowerCase());
}

function parameterExpressionForColumn(column: ColumnDefinition, index: number): string {
  const placeholder = parameterPlaceholder(index);
  return isPostgresTextLikeColumn(column) ? `CAST(${placeholder} AS TEXT)` : placeholder;
}

function textComparisonExpression(expression: string): string {
  return `LOWER(${getSqlDialect().textCast(expression)})`;
}

function resolveFilterColumns(table: TableDefinition, filterColumn?: string | null): ColumnDefinition[] {
  const column = findFilterColumn(table.columns, filterColumn);
  return column ? [column] : table.columns;
}

function getEditableColumns(table: TableDefinition): ColumnDefinition[] {
  return table.columns.filter((column) => column.editable || column.name === table.primaryKey);
}

async function getSupportedTable(
  tableName: string,
): Promise<{ table: TableDefinition; delegate: NautilusDelegate }> {
  const table = await getTable(tableName);

  if (!table) {
    throw new TableNotFoundError(`Unknown table ${JSON.stringify(tableName)}.`);
  }

  if (!table.supportsCrud) {
    throw new UnsupportedTableError(`CRUD is not available for ${table.displayName} yet.`);
  }

  return {
    table,
    delegate: await getFirstDelegate(),
  };
}

function requirePrimaryKey(table: TableDefinition): string {
  if (!table.primaryKey) {
    throw new UnsupportedTableError(`${table.displayName} has no single-column primary key.`);
  }
  return table.primaryKey;
}

function requirePrimaryKeyColumn(table: TableDefinition): ColumnDefinition {
  const primaryKey = requirePrimaryKey(table);
  const column = table.columns.find((candidate) => candidate.name === primaryKey);
  if (!column) {
    throw new UnsupportedTableError(`${table.displayName} has no configured primary key column.`);
  }
  return column;
}

function normalizeSqlRecord(table: TableDefinition, record: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const consumed = new Set<string>();

  for (const column of table.columns) {
    if (column.dbName in record) {
      normalized[column.name] = normalizeValue(record[column.dbName]);
      consumed.add(column.dbName);
      continue;
    }
    if (column.name in record) {
      normalized[column.name] = normalizeValue(record[column.name]);
      consumed.add(column.name);
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (consumed.has(key)) {
      continue;
    }
    normalized[key] = normalizeValue(value);
  }

  return normalized;
}

async function selectRowByPrimaryKey(
  table: TableDefinition,
  delegate: NautilusDelegate,
  pk: string,
): Promise<Record<string, unknown> | null> {
  const params: unknown[] = [];
  const rows = await delegate.rawStmtQuery(
    [
      `SELECT * FROM ${tableReference(table.tableName)}`,
      `WHERE ${buildPrimaryKeyPredicate(table, pk, params)}`,
      "LIMIT 1",
    ].join(" "),
    params,
  );

  return rows[0] ? normalizeSqlRecord(table, rows[0]) : null;
}

function buildPrimaryKeyPredicate(
  table: TableDefinition,
  pk: string,
  params: unknown[],
  tableAlias?: string,
): string {
  const primaryKeyColumn = requirePrimaryKeyColumn(table);
  params.push(coerceValue(pk, primaryKeyColumn));
  const qualifiedName = tableAlias
    ? `${tableAlias}.${quoteIdentifier(primaryKeyColumn.dbName)}`
    : quoteIdentifier(primaryKeyColumn.dbName);
  return `${qualifiedName} = ${parameterExpressionForColumn(primaryKeyColumn, params.length)}`;
}

function buildRawFilterClause(
  table: TableDefinition,
  filterText: string,
  filterColumn: string | null | undefined,
  filterOperator: string | null | undefined,
  params: unknown[],
): string {
  const normalized = filterText.trim();
  if (!normalized) {
    return "";
  }

  const buildPredicate = (column: ColumnDefinition, value: string, operator?: string | null) => {
    const normalizedOperator = normalizeFilterOperator(operator);
    const columnExpression = `t.${quoteIdentifier(column.dbName)}`;

    if (normalizedOperator === "contains") {
      params.push(formatFilterSearchValue(value, normalizedOperator));
      const parameterExpression = parameterPlaceholder(params.length);
      return `${textComparisonExpression(columnExpression)} LIKE ${textComparisonExpression(parameterExpression)}`;
    }

    try {
      params.push(coerceValue(value, column));
    } catch {
      return "1=0";
    }

    return `${columnExpression} ${getFilterSqlOperator(normalizedOperator)} ${parameterExpressionForColumn(column, params.length)}`;
  };

  if (isAdvancedFilter(normalized)) {
    const sqlParts: string[] = [];

    for (const token of splitFilterExpression(normalized)) {
      if (!token.trim()) continue;

      const upperToken = token.toUpperCase();
      if (upperToken === "AND" || upperToken === "OR") {
        sqlParts.push(upperToken);
        continue;
      }

      const parsed = parseFilterInput(token);
      const column = findFilterColumn(table.columns, parsed.columnName);
      if (!parsed.hasColon || !column) {
        sqlParts.push("1=0");
        continue;
      }

      sqlParts.push(buildPredicate(column, parsed.searchValue, parsed.operator));
    }

    if (sqlParts.length === 0) return "";
    return `WHERE (${sqlParts.join(" ")})`;
  }

  const predicates = resolveFilterColumns(table, filterColumn).map((column) =>
    buildPredicate(column, normalized, filterOperator),
  );

  if (predicates.length === 0) {
    return "";
  }
  if (predicates.length === 1) {
    return `WHERE ${predicates[0]}`;
  }
  return `WHERE (${predicates.join(" OR ")})`;
}

function buildRawOrderClause(
  table: TableDefinition,
  orderColumn: string | null | undefined,
  orderDirection: string | null | undefined,
): string {
  const primaryKeyColumn = requirePrimaryKeyColumn(table);
  const selectedColumn =
    table.columns.find(
      (candidate) => candidate.name === orderColumn || candidate.dbName === orderColumn,
    ) ?? primaryKeyColumn;
  const direction = ((orderDirection ?? "").trim().toLowerCase() === "desc" ? "desc" : "asc").toUpperCase();
  const clauses = [`t.${quoteIdentifier(selectedColumn.dbName)} ${direction}`];

  if (selectedColumn.dbName !== primaryKeyColumn.dbName) {
    clauses.push(`t.${quoteIdentifier(primaryKeyColumn.dbName)} ${direction}`);
  }

  return `ORDER BY ${clauses.join(", ")}`;
}

async function selectRowsWithRawSql(
  table: TableDefinition,
  options: {
    filterText?: string;
    filterColumn?: string | null;
    filterOperator?: string | null;
    orderColumn?: string | null;
    orderDirection?: string | null;
    skip?: number;
    take?: number;
  },
) {
  const delegate = await getFirstDelegate();
  const params: unknown[] = [];
  const sqlParts = [
    `SELECT * FROM ${tableReference(table.tableName)} AS t`,
  ];

  const whereClause = buildRawFilterClause(
    table,
    options.filterText ?? "",
    options.filterColumn,
    options.filterOperator,
    params,
  );
  if (whereClause) {
    sqlParts.push(whereClause);
  }

  sqlParts.push(buildRawOrderClause(table, options.orderColumn, options.orderDirection));

  if (options.take !== undefined) {
    params.push(options.take);
    sqlParts.push(`LIMIT ${parameterPlaceholder(params.length)}`);
  }
  if (options.skip !== undefined) {
    params.push(options.skip);
    sqlParts.push(`OFFSET ${parameterPlaceholder(params.length)}`);
  }

  const rows = await delegate.rawStmtQuery(sqlParts.join(" "), params);
  return rows.map((row) => normalizeSqlRecord(table, row));
}

async function countRowsWithRawSql(
  table: TableDefinition,
  options: {
    filterText?: string;
    filterColumn?: string | null;
    filterOperator?: string | null;
  },
): Promise<number> {
  const params: unknown[] = [];
  const sqlParts = [
    `SELECT COUNT(*) AS total_rows FROM ${tableReference(table.tableName)} AS t`,
  ];
  const whereClause = buildRawFilterClause(
    table,
    options.filterText ?? "",
    options.filterColumn,
    options.filterOperator,
    params,
  );
  if (whereClause) {
    sqlParts.push(whereClause);
  }

  const delegate = await getFirstDelegate();
  const rows = await delegate.rawStmtQuery(sqlParts.join(" "), params);
  return Number(rows[0]?.total_rows ?? 0);
}

function normalizeEmptyValue(rawValue: FormDataEntryValue | null, column: ColumnDefinition): string | null {
  if (rawValue === null) {
    return null;
  }
  const normalized = String(rawValue);
  
  if (column.kind === "string") {
    if (column.nullable) {
      if (normalized === "NULL") {
        return null;
      }
      if (normalized === "" && (column.relation || column.enumValues.length > 0)) {
        return null;
      }
    }
    return normalized;
  }
  
  if (column.kind === "list" || column.kind === "json") {
    if (normalized === "NULL" && column.nullable) {
      return null;
    }
    const trimmed = normalized.trim();
    return trimmed || null;
  }
  
  const trimmed = normalized.trim();
  return trimmed || null;
}

function validateMissingValue(column: ColumnDefinition) {
  if (column.required && !column.nullable) {
    throw new InvalidFieldValueError(`${column.label} is required.`);
  }
}

function coerceJsonObject(rawValue: string, column: ColumnDefinition): Record<string, unknown> {
  const parsed = JSON.parse(rawValue);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new InvalidFieldValueError(`${column.label} must be a JSON object.`);
}

function splitListValue(value: string): string[] {
  return value
    .replaceAll("\r", "\n")
    .replaceAll(",", "\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean);
}

function coerceValue(rawValue: FormDataEntryValue | null, column: ColumnDefinition): unknown {
  if (column.inputType === "checkbox" && rawValue === null) {
    return column.nullable ? null : false;
  }

  const normalized = normalizeEmptyValue(rawValue, column);
  if (normalized === null) {
    validateMissingValue(column);
    return null;
  }

  try {
    if (column.enumValues.length > 0) {
      if (!column.enumValues.includes(normalized)) {
        throw new InvalidFieldValueError(
          `${column.label} must be one of: ${column.enumValues.join(", ")}.`,
        );
      }
      return normalized;
    }

    switch (column.kind) {
      case "boolean": {
        const value = normalized.toLowerCase();
        if (["1", "true", "yes", "on"].includes(value)) {
          return true;
        }
        if (["0", "false", "no", "off"].includes(value)) {
          return false;
        }
        throw new InvalidFieldValueError(`${column.label} must be a valid boolean value.`);
      }
      case "int":
        return Number.parseInt(normalized, 10);
      case "float":
      case "decimal":
        return Number(normalized);
      case "date":
      case "datetime":
      case "time":
        return new Date(normalized);
      case "uuid":
      case "string":
        return normalized;
      case "json":
        return coerceJsonObject(normalized, column);
      case "list": {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) return parsed;
        if (parsed !== undefined) throw new InvalidFieldValueError(`${column.label} must be a JSON array.`);
        
        const values = splitListValue(normalized);
        if (values.length > 0) return values;
        
        throw new InvalidFieldValueError(
          `${column.label} must be a JSON array or a comma-separated list.`,
        );
      }
      default:
        return normalized;
    }
  } catch (error) {
    if (error instanceof InvalidFieldValueError) {
      throw error;
    }
    throw new InvalidFieldValueError(`${column.label} has an invalid value.`);
  }
}

function getSubmittedColumns(table: TableDefinition, formData: FormData): ColumnDefinition[] {
  const inlineColumnName = formData.get("__inline_column");
  const editableColumns = getEditableColumns(table);

  if (inlineColumnName === null) {
    return editableColumns;
  }

  const column = editableColumns.find((candidate) => candidate.name === String(inlineColumnName));
  if (!column) {
    throw new InvalidFieldValueError("The inline edit target is invalid.");
  }

  return [column];
}

function formDataFromEntries(entries: InlineEditEntry[]): FormData {
  const formData = new FormData();

  for (const entry of entries) {
    formData.append(entry.key, entry.value);
  }

  return formData;
}

function extractFormPayload(table: TableDefinition, formData: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const column of getSubmittedColumns(table, formData)) {
    if (formData.get(`${column.name}-is-null`) !== null) {
      if (!column.nullable) {
        throw new InvalidFieldValueError(`${column.label} cannot be null.`);
      }
      payload[column.name] = null;
      continue;
    }

    const rawValue = formData.get(column.name);
    if (rawValue === null && column.name === table.primaryKey) {
      continue;
    }

    const coerced =
      column.inputType === "checkbox" && rawValue === null
        ? false
        : coerceValue(rawValue, column);
    if (coerced === null) {
      if (column.nullable) {
        payload[column.name] = null;
      }
      continue;
    }
    payload[column.name] = coerced;
  }

  if (Object.keys(payload).length === 0) {
    throw new InvalidFieldValueError("No editable fields were submitted.");
  }

  return payload;
}

function buildRawUpdateStatement(
  table: TableDefinition,
  pk: string,
  payload: Record<string, unknown>,
  options?: { includeReturning?: boolean },
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const assignments: string[] = [];

  for (const column of getEditableColumns(table)) {
    if (!(column.name in payload)) {
      continue;
    }

    params.push(payload[column.name]);
    assignments.push(
      `${quoteIdentifier(column.dbName)} = ${parameterExpressionForColumn(column, params.length)}`,
    );
  }

  if (assignments.length === 0) {
    throw new InvalidFieldValueError("No editable fields were submitted.");
  }

  return {
    sql: [
      `UPDATE ${tableReference(table.tableName)}`,
      `SET ${assignments.join(", ")}`,
      `WHERE ${buildPrimaryKeyPredicate(table, pk, params)}`,
      ...(options?.includeReturning === false ? [] : ["RETURNING *"]),
    ].join(" "),
    params,
  };
}

function buildRawInsertStatement(
  table: TableDefinition,
  payload: Record<string, unknown>,
  options?: { includeReturning?: boolean },
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const columnNames: string[] = [];
  const values: string[] = [];

  for (const column of getEditableColumns(table)) {
    if (!(column.name in payload)) {
      continue;
    }

    params.push(payload[column.name]);
    columnNames.push(quoteIdentifier(column.dbName));
    values.push(parameterExpressionForColumn(column, params.length));
  }

  if (columnNames.length === 0) {
    throw new InvalidFieldValueError("No editable fields were submitted.");
  }

  return {
    sql: [
      `INSERT INTO ${tableReference(table.tableName)}`,
      `(${columnNames.join(", ")})`,
      `VALUES (${values.join(", ")})`,
      ...(options?.includeReturning === false ? [] : ["RETURNING *"]),
    ].join(" "),
    params,
  };
}

async function resolveInsertedPrimaryKeyValue(
  table: TableDefinition,
  delegate: NautilusDelegate,
  payload: Record<string, unknown>,
): Promise<string> {
  const primaryKeyColumn = requirePrimaryKeyColumn(table);
  const providedPrimaryKey = payload[primaryKeyColumn.name];

  if (providedPrimaryKey !== undefined && providedPrimaryKey !== null) {
    return String(providedPrimaryKey);
  }

  if (getSqlDialect().provider !== "mysql") {
    throw new UnsupportedTableError(
      `${table.displayName} inserts require a retrievable primary key value.`,
    );
  }

  if (primaryKeyColumn.kind !== "int") {
    throw new UnsupportedTableError(
      `${table.displayName} inserts require an explicit primary key when using MySQL.`,
    );
  }

  const rows = await delegate.rawStmtQuery("SELECT LAST_INSERT_ID() AS inserted_id");
  const insertedId = rows[0]?.inserted_id;

  if (insertedId === undefined || insertedId === null) {
    throw new RecordNotFoundError(`Insert into ${table.displayName} could not determine the new primary key.`);
  }

  return String(insertedId);
}

async function executeUpdateRow(
  table: TableDefinition,
  delegate: NautilusDelegate,
  pk: string,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const payload = extractFormPayload(table, formData);
  const { sql, params } = buildRawUpdateStatement(table, pk, payload, {
    includeReturning: getSqlDialect().supportsReturning,
  });
  const rows = await delegate.rawStmtQuery(sql, params);

  if (getSqlDialect().supportsReturning) {
    if (rows.length === 0) {
      throw new RecordNotFoundError(`Record ${JSON.stringify(pk)} was not found.`);
    }

    return normalizeSqlRecord(table, rows[0]);
  }

  const record = await selectRowByPrimaryKey(table, delegate, pk);
  if (!record) {
    throw new RecordNotFoundError(`Record ${JSON.stringify(pk)} was not found.`);
  }

  return record;
}

export async function listRows(
  tableName: string,
  options?: {
    page?: number;
    pageSize?: number;
    filterText?: string;
    filterColumn?: string | null;
    filterOperator?: string | null;
    orderColumn?: string | null;
    orderDirection?: string | null;
  },
): Promise<[Record<string, unknown>[], number]> {
  const { table } = await getSupportedTable(tableName);
  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 25;
  const skip = Math.max(page - 1, 0) * pageSize;

  const rows = await selectRowsWithRawSql(table, {
    filterText: options?.filterText ?? "",
    filterColumn: options?.filterColumn,
    filterOperator: options?.filterOperator,
    orderColumn: options?.orderColumn,
    orderDirection: options?.orderDirection ?? "asc",
    skip,
    take: pageSize,
  });
  const total = await countRowsWithRawSql(table, {
    filterText: options?.filterText ?? "",
    filterColumn: options?.filterColumn,
    filterOperator: options?.filterOperator,
  });

  return [rows, total];
}

export async function listAllRows(tableName: string): Promise<Record<string, unknown>[]> {
  const { table } = await getSupportedTable(tableName);
  return selectRowsWithRawSql(table, {
    orderColumn: requirePrimaryKey(table),
    orderDirection: "asc",
  });
}

export async function getRow(
  tableName: string,
  pk: string,
): Promise<Record<string, unknown>> {
  const { table, delegate } = await getSupportedTable(tableName);
  const record = await selectRowByPrimaryKey(table, delegate, pk);
  if (!record) {
    throw new RecordNotFoundError(`${table.displayName} record ${JSON.stringify(pk)} was not found.`);
  }

  return record;
}

export async function createRow(
  tableName: string,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const { table, delegate } = await getSupportedTable(tableName);
  const payload = extractFormPayload(table, formData);
  const { sql, params } = buildRawInsertStatement(table, payload, {
    includeReturning: getSqlDialect().supportsReturning,
  });
  const rows = await delegate.rawStmtQuery(sql, params);

  if (getSqlDialect().supportsReturning) {
    if (rows.length === 0) {
      throw new RecordNotFoundError(`Insert into ${table.displayName} returned no rows.`);
    }

    return normalizeSqlRecord(table, rows[0]);
  }

  const insertedPk = await resolveInsertedPrimaryKeyValue(table, delegate, payload);
  const record = await selectRowByPrimaryKey(table, delegate, insertedPk);

  if (!record) {
    throw new RecordNotFoundError(`Insert into ${table.displayName} returned no rows.`);
  }

  return record;
}

export async function updateRow(
  tableName: string,
  pk: string,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const { table, delegate } = await getSupportedTable(tableName);
  return executeUpdateRow(table, delegate, pk, formData);
}

export async function applyInlineEdits(
  tableName: string,
  edits: InlineEditOperation[],
  options?: { useTransaction?: boolean },
): Promise<number> {
  if (edits.length === 0) {
    return 0;
  }

  const { table, delegate } = await getSupportedTable(tableName);

  const runEdits = async (activeDelegate: NautilusDelegate): Promise<number> => {
    let appliedCount = 0;

    for (const edit of edits) {
      try {
        await executeUpdateRow(
          table,
          activeDelegate,
          edit.pk,
          formDataFromEntries(edit.entries),
        );
        appliedCount += 1;
      } catch (error) {
        if (options?.useTransaction) {
          throw error;
        }

        const message =
          error instanceof AdminError ? error.message : userVisibleError(error);
        throw new PartialInlineApplyError(message, appliedCount);
      }
    }

    return appliedCount;
  };

  if (options?.useTransaction) {
    const db = await getDb();
    return db.$transaction(async (tx) => runEdits(tx));
  }

  return runEdits(delegate);
}

export async function deleteRow(
  tableName: string,
  pk: string,
): Promise<Record<string, unknown> | null> {
  const { table, delegate } = await getSupportedTable(tableName);
  if (!getSqlDialect().supportsReturning) {
    const existing = await selectRowByPrimaryKey(table, delegate, pk);
    if (!existing) {
      return null;
    }

    const params: unknown[] = [];
    await delegate.rawStmtQuery(
      [
        `DELETE FROM ${tableReference(table.tableName)}`,
        `WHERE ${buildPrimaryKeyPredicate(table, pk, params)}`,
      ].join(" "),
      params,
    );

    return existing;
  }

  const params: unknown[] = [];
  const rows = await delegate.rawStmtQuery(
    [
      `DELETE FROM ${tableReference(table.tableName)}`,
      `WHERE ${buildPrimaryKeyPredicate(table, pk, params)}`,
      "RETURNING *",
    ].join(" "),
    params,
  );
  return rows[0] ? normalizeSqlRecord(table, rows[0]) : null;
}

export async function buildTableView(
  tableSlug: string,
  options?: {
    page?: number;
    pageSize?: number;
    filterText?: string;
    filterColumn?: string;
    filterOperator?: string;
    orderColumn?: string;
    orderDirection?: string;
  },
): Promise<TableView> {
  const table = await getTable(tableSlug);

  if (!table) {
    throw new TableNotFoundError(`Unknown table ${JSON.stringify(tableSlug)}.`);
  }

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 25;

  if (!table.supportsCrud) {
    return {
      table,
      rows: [],
      totalRows: 0,
      page,
      pageSize,
      totalPages: 1,
      filterText: options?.filterText,
      filterColumn: options?.filterColumn,
      filterOperator: options?.filterOperator,
      orderColumn: options?.orderColumn,
      orderDirection: options?.orderDirection,
      errorMessage: "CRUD is not available for this table yet.",
    };
  }

  try {
    const [rows, totalRows] = await listRows(table.slug, {
      page,
      pageSize,
      filterText: options?.filterText,
      filterColumn: options?.filterColumn,
      filterOperator: options?.filterOperator,
      orderColumn: options?.orderColumn,
      orderDirection: options?.orderDirection,
    });
    return {
      table,
      rows,
      totalRows,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
      filterText: options?.filterText,
      filterColumn: options?.filterColumn,
      filterOperator: options?.filterOperator,
      orderColumn: options?.orderColumn,
      orderDirection: options?.orderDirection,
      errorMessage: null,
    };
  } catch (error) {
    return {
      table,
      rows: [],
      totalRows: 0,
      page,
      pageSize,
      totalPages: 1,
      filterText: options?.filterText,
      filterColumn: options?.filterColumn,
      filterOperator: options?.filterOperator,
      orderColumn: options?.orderColumn,
      orderDirection: options?.orderDirection,
      errorMessage:
        error instanceof AdminError ? error.message : userVisibleError(error),
    };
  }
}

export async function getRelationPickerData(
  tableSlug: string,
): Promise<{
  table: TableDefinition;
  rows: Record<string, unknown>[];
  errorMessage: string | null;
}> {
  const table = await getTable(tableSlug);

  if (!table) {
    throw new TableNotFoundError(`Unknown table ${JSON.stringify(tableSlug)}.`);
  }

  if (!table.supportsCrud || !table.primaryKey) {
    return {
      table,
      rows: [],
      errorMessage: `${table.displayName} cannot be used as a relation target.`,
    };
  }

  try {
    return {
      table,
      rows: await listAllRows(table.slug),
      errorMessage: null,
    };
  } catch (error) {
    return {
      table,
      rows: [],
      errorMessage: error instanceof AdminError ? error.message : userVisibleError(error),
    };
  }
}

export async function getSidebarTables(): Promise<TableDefinition[]> {
  const registry = await loadRegistry();
  return registry.tables;
}
