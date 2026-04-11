import type { InputType } from "@/lib/nautilus/types";
import { sortObjectKeys } from "@/lib/nautilus/utils";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateForInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDateTimeForInput(date: Date): string {
  return `${formatDateForInput(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTimeForInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        normalizeValue(inner),
      ]),
    );
  }
  return value;
}

export function stringifyValue(
  value: unknown,
  options?: {
    inputType?: InputType | null;
    mode?: "display" | "input";
  },
): string {
  const normalized = normalizeValue(value);
  const inputType = options?.inputType ?? null;
  const mode = options?.mode ?? "display";

  if (normalized === null || normalized === undefined) return "";
  if (typeof normalized === "boolean") return String(normalized);

  if (normalized instanceof Date) {
    if (mode === "input") {
      return inputType === "date"
        ? formatDateForInput(normalized)
        : inputType === "time"
          ? formatTimeForInput(normalized)
          : formatDateTimeForInput(normalized);
    }
    return normalized.toISOString();
  }

  return typeof normalized === "object"
    ? JSON.stringify(sortObjectKeys(normalized))
    : String(normalized);
}

export const formatCell = stringifyValue;
export const serializeRelationValue = stringifyValue;
export const inputValue = (value: unknown, inputType?: InputType | null) =>
  stringifyValue(value, { inputType, mode: "input" });
