import type { ColumnDefinition } from "@/lib/nautilus/types";

export type FilterColumn = Pick<ColumnDefinition, "name" | "dbName" | "label">;

export const FILTER_OPERATOR_CONFIG = {
  contains: { syntax: ":", label: "contains", sql: "ILIKE" },
  eq: { syntax: ":=", label: "equals", sql: "=" },
  neq: { syntax: ":!=", label: "is not", sql: "!=" },
  gt: { syntax: ":>", label: ">", sql: ">" },
  gte: { syntax: ":>=", label: ">=", sql: ">=" },
  lt: { syntax: ":<", label: "<", sql: "<" },
  lte: { syntax: ":<=", label: "<=", sql: "<=" },
} as const;

export type FilterOperator = keyof typeof FILTER_OPERATOR_CONFIG;

export interface ParsedFilterInput {
  prefix: string;
  columnName: string;
  hasColon: boolean;
  searchValue: string;
  operator: FilterOperator;
  rawOperator: string;
}

const ADVANCED_FILTER_RE = /^[a-zA-Z0-9_]+:(?:>=|<=|!=|=|>|<)?/;
const LOGICAL_SPLIT_RE = /\s+(AND|OR)\s+(?=[a-zA-Z0-9_]+:(?:>=|<=|!=|=|>|<)?)/i;
const OPERATOR_BY_SYNTAX = (Object.entries(FILTER_OPERATOR_CONFIG) as Array<
  [FilterOperator, (typeof FILTER_OPERATOR_CONFIG)[FilterOperator]]
>)
  .map(([operator, config]) => [config.syntax, operator] as const)
  .sort(([left], [right]) => right.length - left.length);

export const NON_CONTAINS_FILTER_OPERATORS = (
  Object.keys(FILTER_OPERATOR_CONFIG) as FilterOperator[]
).filter((operator) => operator !== "contains");

export function normalizeFilterOperator(operator?: string | null): FilterOperator {
  return operator && operator in FILTER_OPERATOR_CONFIG
    ? (operator as FilterOperator)
    : "contains";
}

export function findFilterColumn<T extends FilterColumn>(
  columns: T[],
  name?: string | null,
): T | undefined {
  return name
    ? columns.find((column) => column.name === name || column.dbName === name)
    : undefined;
}

export function getFilterOperatorSyntax(operator?: string | null): string {
  return FILTER_OPERATOR_CONFIG[normalizeFilterOperator(operator)].syntax;
}

export function getFilterOperatorLabel(operator?: string | null): string {
  return FILTER_OPERATOR_CONFIG[normalizeFilterOperator(operator)].label;
}

export function getFilterSqlOperator(operator?: string | null): string {
  return FILTER_OPERATOR_CONFIG[normalizeFilterOperator(operator)].sql;
}

export function formatFilterSearchValue(value: string, operator?: string | null): string {
  return normalizeFilterOperator(operator) === "contains" ? `%${value}%` : value;
}

export function formatFilterInput(
  columns: FilterColumn[],
  filterText = "",
  filterColumn?: string | null,
  filterOperator?: string | null,
): string {
  const column = findFilterColumn(columns, filterColumn);
  return column && filterText
    ? `${column.name}${getFilterOperatorSyntax(filterOperator)}${filterText}`
    : filterText;
}

export function isAdvancedFilter(text: string): boolean {
  return ADVANCED_FILTER_RE.test(text.trim());
}

export function splitFilterExpression(text: string): string[] {
  return text.split(LOGICAL_SPLIT_RE).filter(Boolean);
}

export function parseFilterInput(text: string): ParsedFilterInput {
  const match = text.match(/^(.*\s+(?:AND|OR)\s+)(.*)$/);
  const prefix = match ? match[1] : "";
  const currentToken = match ? match[2] : text;
  const colonIndex = currentToken.indexOf(":");

  if (colonIndex < 0) {
    const searchValue = currentToken.trim();
    return {
      prefix,
      columnName: searchValue,
      hasColon: false,
      searchValue,
      operator: "contains",
      rawOperator: "",
    };
  }

  const columnName = currentToken.slice(0, colonIndex).trim();
  const remainder = currentToken.slice(colonIndex);
  const [rawOperator, operator] = OPERATOR_BY_SYNTAX.find(([syntax]) => remainder.startsWith(syntax))
    ?? [":", "contains"];

  return {
    prefix,
    columnName,
    hasColon: true,
    searchValue: remainder.slice(rawOperator.length).trim(),
    operator,
    rawOperator,
  };
}
