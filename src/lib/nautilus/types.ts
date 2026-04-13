export type ValueKind =
  | "string"
  | "int"
  | "float"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "time"
  | "uuid"
  | "list"
  | "json";

export type DatabaseProvider = "postgresql" | "sqlite" | "mysql";

export type InputType =
  | "text"
  | "email"
  | "number"
  | "checkbox"
  | "date"
  | "datetime-local"
  | "time"
  | "select";

export interface RelationDefinition {
  targetTableName: string;
  targetTableSlug: string;
  targetColumn: string;
  targetDisplayName: string;
  displayName: string;
}

export interface ColumnDefinition {
  name: string;
  dbName: string;
  nativeType: string;
  label: string;
  kind: ValueKind;
  enumValues: string[];
  required: boolean;
  editable: boolean;
  nullable: boolean;
  hasDefault: boolean;
  autoUpdate: boolean;
  inputType: InputType;
  relation: RelationDefinition | null;
}

export interface TableDefinition {
  tableName: string;
  slug: string;
  primaryKey: string | null;
  primaryKeyColumn: string | null;
  columns: ColumnDefinition[];
  supportsCrud: boolean;
  title: string;
  displayName: string;
}

export interface TableRegistryData {
  tables: TableDefinition[];
  aliases: Map<string, string>;
}

export interface TableView {
  table: TableDefinition;
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filterText?: string;
  filterColumn?: string;
  filterOperator?: string;
  orderColumn?: string;
  orderDirection?: string;
  errorMessage: string | null;
}

export interface RawQueryView {
  sql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  submitted: boolean;
  errorMessage: string | null;
}

export interface RowActionState {
  errorMessage: string | null;
  values: Record<string, string>;
}

export interface InlineEditEntry {
  key: string;
  value: string;
}

export interface InlineEditOperation {
  pk: string;
  entries: InlineEditEntry[];
}

export interface InlineEditActionResult {
  errorMessage: string | null;
  appliedCount: number;
}

export interface QueryActionState {
  sql: string;
  rows: Record<string, unknown>[];
  columns: string[];
  rowCount: number;
  errorMessage: string | null;
  submitted: boolean;
}

export interface RelationPickerResponse {
  table: TableDefinition;
  rows: Record<string, unknown>[];
  errorMessage: string | null;
}
