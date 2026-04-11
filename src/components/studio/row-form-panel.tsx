"use client";

import { useActionState, useState } from "react";

import { CopyValue } from "@/components/studio/copy-value";
import { FieldControl } from "@/components/studio/field-control";
import { serializeRelationValue } from "@/lib/nautilus/presentation";
import type {
  ColumnDefinition,
  RelationPickerResponse,
  RowActionState,
  TableDefinition,
} from "@/lib/nautilus/types";

interface PickerState {
  column: ColumnDefinition | null;
  currentValue: string;
  loading: boolean;
  response: RelationPickerResponse | null;
  errorMessage: string | null;
}

const EMPTY_PICKER_STATE: PickerState = {
  column: null,
  currentValue: "",
  loading: false,
  response: null,
  errorMessage: null,
};

function RelationPickerModal({
  pickerState,
  onClose,
  onSelect,
  onClear,
}: {
  pickerState: PickerState;
  onClose: () => void;
  onSelect: (value: string) => void;
  onClear: () => void;
}) {
  const { column, currentValue, loading, response, errorMessage } = pickerState;
  if (!column) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="Close relation picker" />
      <div className="relative flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-(--line) bg-(--panel) shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_80px_rgba(0,0,0,0.45)] animate-slide-in-up">
        <div className="flex items-center justify-between gap-4 border-b border-(--line) px-4 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-(--line) bg-(--panel-2) text-lg text-white transition hover:border-zinc-500 hover:bg-zinc-800"
              onClick={onClose}
              aria-label="Back"
            >
              ←
            </button>
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-white">
                {response?.table.displayName ?? column.relation?.displayName}
              </h3>
              {response?.table.primaryKey ? (
                <p className="text-xs uppercase tracking-[0.16em] text-(--muted)">
                  {response.table.primaryKey}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            className="rounded-2xl border border-(--line) px-3 py-2 text-sm text-(--muted) transition hover:border-zinc-500 hover:text-white"
            onClick={onClear}
          >
            Clear
          </button>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-sm text-(--muted)">Loading relation picker…</div>
        ) : errorMessage || response?.errorMessage ? (
          <div className="px-6 py-8 text-sm text-red-200">{errorMessage ?? response?.errorMessage}</div>
        ) : response ? (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 border-b border-(--line) bg-(--panel) text-left text-xs uppercase tracking-[0.16em] text-(--muted)">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  {response.table.columns.map((column) => (
                    <th key={column.name} className="px-4 py-3 font-medium">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {response.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={response.table.columns.length + 1}
                      className="px-4 py-10 text-center text-sm text-(--muted)"
                    >
                      Empty
                    </td>
                  </tr>
                ) : (
                  response.rows.map((row, index) => {
                    const rowValue = serializeRelationValue(row[response.table.primaryKey ?? ""]);
                    return (
                      <tr
                        key={`${rowValue}:${index}`}
                        className={`transition hover:bg-zinc-900/50 ${rowValue === currentValue ? "bg-zinc-900/80" : ""}`}
                      >
                        <td className="px-4 py-3 align-middle">
                          <button
                            type="button"
                            className="rounded-2xl border border-(--line) px-3 py-2 text-xs uppercase tracking-[0.16em] text-(--muted) transition hover:border-zinc-400 hover:text-white"
                            onClick={() => onSelect(rowValue)}
                          >
                            Use
                          </button>
                        </td>
                        {response.table.columns.map((column) => (
                          <td key={column.name} className="px-4 py-3 text-zinc-200">
                            <CopyValue value={row[column.name]} />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RowFormPanel({
  table,
  mode,
  onCancel,
  initialValues,
  action,
}: {
  table: TableDefinition;
  mode: "create" | "update";
  onCancel: () => void;
  initialValues: Record<string, unknown>;
  action: (
    state: RowActionState,
    formData: FormData,
  ) => Promise<RowActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {
    errorMessage: null,
    values: {},
  });
  const [relationValues, setRelationValues] = useState<Record<string, string>>({});
  const [pickerState, setPickerState] = useState<PickerState>(EMPTY_PICKER_STATE);
  const formKey = JSON.stringify(state.values);
  const title = `${mode === "create" ? "Create" : "Edit"} ${table.displayName}`;
  const description =
    mode === "create"
      ? "Enter values for the new row."
      : "Update the selected row and submit to save changes.";
  const submitLabel = pending
    ? mode === "create"
      ? "Creating row"
      : "Saving changes"
    : mode === "create"
      ? "Create row"
      : "Save changes";

  const closePicker = () => setPickerState(EMPTY_PICKER_STATE);
  const getRelationValue = (columnName: string) =>
    relationValues[columnName]
    ?? state.values[columnName]
    ?? serializeRelationValue(initialValues[columnName]);

  async function openPicker(column: ColumnDefinition) {
    const currentValue = getRelationValue(column.name);
    setPickerState({
      ...EMPTY_PICKER_STATE,
      column,
      currentValue,
      loading: true,
    });

    try {
      const response = await fetch(`/api/tables/${column.relation!.targetTableSlug}/relation-picker`, {
        cache: "no-store",
      });
      setPickerState({
        column,
        currentValue,
        loading: false,
        response: (await response.json()) as RelationPickerResponse,
        errorMessage: null,
      });
    } catch {
      setPickerState({
        column,
        currentValue,
        loading: false,
        response: null,
        errorMessage: "Failed to load relation picker.",
      });
    }
  }

  const setRelationValue = (columnName: string, value: string) => {
    setRelationValues((current) => ({
      ...current,
      [columnName]: value,
    }));
    closePicker();
  };

  return (
    <>
      <div className="absolute inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm animate-fade-in">
        <button type="button" onClick={onCancel} className="absolute inset-0 w-full" aria-label="Close editor" />
        <section className="relative z-10 flex h-full w-full max-w-2xl flex-col overflow-auto border-l border-(--line) bg-(--panel-2) px-6 py-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_80px_rgba(0,0,0,0.45)] animate-slide-in-right">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-1 text-sm text-(--muted)">{description}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer rounded-2xl border border-(--line) px-3 py-2 text-sm text-(--muted) transition hover:border-zinc-500 hover:text-white"
            >
              Cancel
            </button>
          </div>

          <form key={formKey} action={formAction} className="mt-6 flex-1">
            {state.errorMessage ? (
              <div className="mb-4 rounded-[1.25rem] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {state.errorMessage}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              {table.columns
                .filter((column) => column.editable || column.name === table.primaryKey)
                .map((column, index) => {
                  const fieldId = `row-form-${index}`;
                  const value = state.values[column.name] ?? initialValues[column.name];

                  return (
                    <label key={column.name} className="block">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em]">
                        <span className="text-(--muted)">{column.label}</span>
                        <span className="rounded-full border border-(--line) bg-(--panel) px-2 py-1 text-[10px] text-zinc-500">
                          {column.required ? "Required" : "Optional"}
                        </span>
                      </div>
                      <div className="mt-2">
                        <FieldControl
                          column={column}
                          value={value}
                          fieldId={fieldId}
                          relationValue={column.relation ? getRelationValue(column.name) : undefined}
                          onPickRelation={column.relation ? () => openPicker(column) : undefined}
                        />
                      </div>
                    </label>
                  );
                })}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={pending}
                className="cursor-pointer rounded-[1.1rem] bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitLabel}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="cursor-pointer rounded-[1.1rem] border border-(--line) px-4 py-2.5 text-sm text-(--muted) transition hover:border-zinc-500 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      </div>

      <RelationPickerModal
        pickerState={pickerState}
        onClose={closePicker}
        onClear={() => setRelationValue(pickerState.column!.name, "")}
        onSelect={(value) => setRelationValue(pickerState.column!.name, value)}
      />
    </>
  );
}
