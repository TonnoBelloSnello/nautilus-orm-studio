"use client";

import { inputValue } from "@/lib/nautilus/presentation";
import type { ColumnDefinition } from "@/lib/nautilus/types";

type FieldControlVariant = "form" | "inline";
type FieldControlKeyDown = React.KeyboardEventHandler<
  HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
>;

const FORM_INPUT_CLASS =
  "w-full rounded-2xl border border-(--line) bg-(--panel) px-3 py-2 text-sm text-white outline-none transition focus:border-zinc-400";
const INLINE_INPUT_CLASS =
  "w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 outline-none hover:border-zinc-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const INLINE_TEXTAREA_CLASS =
  "min-h-20 w-full resize-none rounded bg-zinc-900 p-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 placeholder:italic focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const INLINE_CHECKBOX_CLASS =
  "rounded border-zinc-700 bg-zinc-900 accent-blue-500 hover:border-zinc-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function textAreaValue(value: unknown): string {
  if (isNullish(value)) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export function checkboxChecked(value: unknown): boolean {
  return ["true", "1", "yes", "on"].includes(
    inputValue(value as string | number | boolean | null | undefined),
  );
}

interface FieldControlProps {
  column: ColumnDefinition;
  value: unknown;
  fieldId?: string;
  autoFocus?: boolean;
  variant?: FieldControlVariant;
  onKeyDown?: FieldControlKeyDown;
  relationValue?: string;
  onPickRelation?: (() => void) | null;
}

export function FieldControl({
  column,
  value,
  fieldId,
  autoFocus,
  variant = "form",
  onKeyDown,
  relationValue,
  onPickRelation,
}: FieldControlProps) {
  const commonProps = {
    id: fieldId,
    name: column.name,
    autoFocus,
    onKeyDown,
  };

  if (column.enumValues.length > 0) {
    return (
      <select
        {...commonProps}
        defaultValue={isNullish(value) ? "" : String(value)}
        className={variant === "inline" ? INLINE_INPUT_CLASS : FORM_INPUT_CLASS}
        required={variant === "form" ? column.required : undefined}
      >
        {variant === "inline" && column.nullable ? (
          <option value="" className="text-zinc-500 italic">
            NULL
          </option>
        ) : (
          <option value="" disabled={column.required && !column.nullable}>
            Select
          </option>
        )}
        {column.enumValues.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (column.inputType === "checkbox") {
    if (variant === "form") {
      return (
        <input
          {...commonProps}
          type="checkbox"
          value="true"
          className="h-4 w-4 rounded border-(--line) bg-(--panel) text-white focus:ring-0"
          defaultChecked={checkboxChecked(value)}
        />
      );
    }

    return (
      <div className="flex items-center space-x-2 p-2">
        <input
          {...commonProps}
          type="checkbox"
          value="true"
          defaultChecked={value === true || value === "true"}
          className={`h-4 w-4 ${INLINE_CHECKBOX_CLASS}`}
        />
        <span className="text-sm text-zinc-300">True</span>
        {column.nullable ? (
          <div className="mb-1 ml-4 flex items-center">
            <input type="checkbox" name={`${column.name}-is-null`} defaultChecked={isNullish(value)} className={INLINE_CHECKBOX_CLASS} />
            <span className="pl-1 font-mono text-xs text-zinc-500">NULL</span>
          </div>
        ) : null}
      </div>
    );
  }

  if (variant === "form" && column.relation && onPickRelation) {
    return (
      <div className="flex items-center gap-2">
        <input
          {...commonProps}
          type="text"
          value={relationValue ?? inputValue(value, column.inputType)}
          readOnly
          className={`${FORM_INPUT_CLASS} outline-none`}
        />
        <button
          type="button"
          onClick={onPickRelation}
          className="shrink-0 rounded-2xl border border-(--line) px-3 py-2 text-xs uppercase tracking-[0.16em] text-(--muted) transition hover:border-zinc-400 hover:text-white"
        >
          Pick
        </button>
      </div>
    );
  }

  if (["date", "datetime-local", "time"].includes(column.inputType)) {
    return (
      <input
        {...commonProps}
        type={column.inputType}
        defaultValue={inputValue(value, column.inputType)}
        className={`${variant === "inline" ? INLINE_INPUT_CLASS : FORM_INPUT_CLASS} ${column.inputType !== "text" ? "scheme-dark" : ""}`.trim()}
        required={variant === "form" ? column.required : undefined}
      />
    );
  }

  if (variant === "inline") {
    return (
      <textarea
        {...commonProps}
        placeholder={isNullish(value) ? "NULL" : ""}
        defaultValue={textAreaValue(value)}
        className={INLINE_TEXTAREA_CLASS}
      />
    );
  }

  return (
    <input
      {...commonProps}
      type={column.inputType}
      defaultValue={inputValue(value, column.inputType)}
      className={FORM_INPUT_CLASS}
      required={column.required}
    />
  );
}
