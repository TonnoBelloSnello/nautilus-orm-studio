"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  applyInlineEditsAction,
  createRowAction,
  deleteRowsAction,
  updateRowAction,
} from "@/app/actions";
import { CopyValue } from "@/components/studio/copy-value";
import { DeleteRowForm } from "@/components/studio/delete-row-form";
import { FilterInput } from "@/components/studio/filter-input";
import { InlineCellEditor } from "@/components/studio/inline-cell-editor";
import { ResizableTh } from "@/components/studio/resizable-th";
import { RowFormPanel } from "@/components/studio/row-form-panel";
import { serializeRelationValue } from "@/lib/nautilus/presentation";
import type {
  ColumnDefinition,
  InlineEditEntry,
  InlineEditOperation,
  TableView,
} from "@/lib/nautilus/types";

type RowRecord = Record<string, unknown>;
type StagedInlineEdit = InlineEditOperation & {
  key: string;
  columnName: string;
  previewValue: unknown;
};

const SELECTION_CHECKBOX_CLASS =
  "h-4 w-4 cursor-pointer appearance-none rounded-sm border border-zinc-500 bg-transparent checked:border-blue-500 checked:bg-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const SELECTION_CHECKBOX_STYLE = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e\")",
};

function inlineEditKey(rowKey: string, columnName: string): string {
  return `${rowKey}:${columnName}`;
}

function serializeInlineEntries(formData: FormData): InlineEditEntry[] {
  return Array.from(formData.entries()).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

function rowKeyFor(primaryKey: string | null, row: RowRecord): string {
  return serializeRelationValue(row[primaryKey ?? ""]);
}

function previewInlineValue(column: ColumnDefinition, formData: FormData): unknown {
  if (formData.get(`${column.name}-is-null`) !== null) {
    return null;
  }

  if (column.inputType === "checkbox") {
    return formData.get(column.name) !== null;
  }

  const rawValue = formData.get(column.name);
  if (rawValue === null) {
    return null;
  }

  const normalized = String(rawValue);
  if (!normalized && column.nullable && (column.relation || column.enumValues.length > 0)) {
    return null;
  }

  if (["int", "float", "decimal"].includes(column.kind)) {
    const numericValue = Number(normalized);
    return Number.isNaN(numericValue) ? normalized : numericValue;
  }

  if (column.kind === "json" || column.kind === "list") {
    try {
      return JSON.parse(normalized);
    } catch {
      return normalized;
    }
  }

  return normalized;
}

function columnTypeLabel(column: ColumnDefinition): string {
  return column.enumValues.length > 0 ? "enum" : column.kind;
}

function PanelMessage({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "warning";
}) {
  const toneClass = tone === "warning"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
    : "border-red-500/40 bg-red-500/10 text-red-200";

  return (
    <div className="px-6 pt-4">
      <div className={`rounded-[1.25rem] border px-4 py-3 text-sm ${toneClass}`}>{children}</div>
    </div>
  );
}

function SelectionCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className={SELECTION_CHECKBOX_CLASS}
      style={checked ? SELECTION_CHECKBOX_STYLE : undefined}
    />
  );
}

export function TablePanel({ view }: { view: TableView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const table = view.table;
  const primaryKey = table.primaryKey;
  const searchParamsStr = searchParams.toString();
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [editingCell, setEditingCell] = useState<{ rowKey: string; columnName: string } | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [stagedEdits, setStagedEdits] = useState<StagedInlineEdit[]>([]);
  const [isPending, startTransition] = useTransition();
  const stagedEditsByKey = useMemo(
    () => new Map(stagedEdits.map((edit) => [edit.key, edit])),
    [stagedEdits],
  );
  const displayedRows = useMemo(
    () =>
      view.rows.map((row) => {
        const baseRow = row as RowRecord;
        const displayedRow = { ...baseRow };

        for (const column of table.columns) {
          const stagedEdit = stagedEditsByKey.get(
            inlineEditKey(rowKeyFor(primaryKey, baseRow), column.name),
          );
          if (stagedEdit) {
            displayedRow[column.name] = stagedEdit.previewValue;
          }
        }

        return displayedRow;
      }),
    [primaryKey, stagedEditsByKey, table.columns, view.rows],
  );
  const stagedEditCount = stagedEdits.length;
  const hasStagedEdits = stagedEditCount > 0;
  const hasOpenInlineEditor = editingCell !== null;
  const allRowsSelected = displayedRows.length > 0 && selectedRowKeys.size === displayedRows.length;
  const firstSelectedKey = selectedRowKeys.values().next().value as string | undefined;
  const selectedRow = firstSelectedKey
    ? displayedRows.find((row) => rowKeyFor(primaryKey, row as RowRecord) === firstSelectedKey)
    : null;

  const updateSearch = (updates: Record<string, string | null>, keepPage = false) => {
    const nextSearchParams = new URLSearchParams(searchParamsStr);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        nextSearchParams.delete(key);
      } else {
        nextSearchParams.set(key, value);
      }
    }
    if (!keepPage && !("page" in updates)) {
      nextSearchParams.set("page", "1");
    }
    startTransition(() => {
      router.push(`${pathname}?${nextSearchParams.toString()}`);
    });
  };

  const stageInlineEdit = (
    rowKey: string,
    column: ColumnDefinition,
    currentValue: unknown,
    formData: FormData,
  ) => {
    const nextEdit: StagedInlineEdit = {
      key: inlineEditKey(rowKey, column.name),
      pk: rowKey,
      columnName: column.name,
      entries: serializeInlineEntries(formData),
      previewValue: previewInlineValue(column, formData),
    };

    setStagedEdits((current) => {
      const nextEdits = current.filter((edit) => edit.key !== nextEdit.key);
      return serializeRelationValue(nextEdit.previewValue) !== serializeRelationValue(currentValue)
        ? [...nextEdits, nextEdit]
        : nextEdits;
    });
    setEditingCell(null);
    setInlineError(null);
  };

  const applyInlineEdits = (useTransaction: boolean) => {
    if (!stagedEdits.length || hasOpenInlineEditor) {
      return;
    }

    startTransition(async () => {
      setInlineError(null);
      const result = await applyInlineEditsAction(
        table.slug,
        stagedEdits.map(({ pk, entries }) => ({ pk, entries })),
        useTransaction,
      );
      const shouldRefresh = result.appliedCount > 0 || !result.errorMessage;

      if (result.appliedCount > 0) {
        setStagedEdits((current) => current.slice(result.appliedCount));
      }

      if (result.errorMessage) {
        setInlineError(result.errorMessage);
        if (shouldRefresh) {
          router.refresh();
        }
        return;
      }

      setStagedEdits([]);
      if (shouldRefresh) {
        router.refresh();
      }
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">{table.displayName}</h2>
          <p className="mt-2 text-sm text-(--muted)">{view.totalRows} rows</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {table.supportsCrud && selectedRowKeys.size > 0 ? (
            <>
              {selectedRowKeys.size === 1 ? (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="cursor-pointer rounded-lg border border-(--line) px-2 py-1 text-[11px] tracking-wide transition hover:border-zinc-500 hover:text-white"
                >
                  Edit
                </button>
              ) : null}
              <DeleteRowForm
                count={selectedRowKeys.size}
                action={async () => {
                  startTransition(async () => {
                    await deleteRowsAction(table.slug, Array.from(selectedRowKeys), searchParamsStr);
                    setSelectedRowKeys(new Set());
                  });
                }}
              />
              <div className="mx-1 h-8 w-px bg-(--line)" />
            </>
          ) : null}

          {hasStagedEdits ? (
            <>
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] tracking-wide text-emerald-200">
                {stagedEditCount} pending {stagedEditCount === 1 ? "edit" : "edits"}
              </div>
              <button
                type="button"
                onClick={() => applyInlineEdits(false)}
                disabled={isPending || hasOpenInlineEditor}
                className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] tracking-wide transition hover:border-emerald-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply edits
              </button>
              <button
                type="button"
                onClick={() => applyInlineEdits(true)}
                disabled={isPending || hasOpenInlineEditor}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] tracking-wide text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply in transaction
              </button>
              <button
                type="button"
                onClick={() => {
                  setStagedEdits([]);
                  setEditingCell(null);
                  setInlineError(null);
                }}
                disabled={isPending}
                className="rounded-lg border border-red-500/40 px-2.5 py-1 text-[11px] tracking-wide transition hover:border-red-400/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <div className="mx-1 h-8 w-px bg-(--line)" />
            </>
          ) : null}

          {table.supportsCrud ? (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="cursor-pointer rounded-lg bg-white px-2.5 py-1 text-[11px] font-medium tracking-wide text-black transition hover:bg-zinc-200"
            >
              Create row
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex border-t border-(--line) bg-zinc-900 px-2">
        <FilterInput
          columns={table.columns}
          initialFilterText={view.filterText}
          initialFilterColumn={view.filterColumn}
          initialFilterOperator={view.filterOperator}
          onSearch={(filterText, filterColumn, filterOperator) =>
            updateSearch({
              filter_text: filterText || null,
              filter_column: filterColumn,
              filter_operator: filterOperator,
            })}
        />
      </div>

      {view.errorMessage ? <PanelMessage>{view.errorMessage}</PanelMessage> : null}
      {inlineError ? <PanelMessage>{inlineError}</PanelMessage> : null}
      {hasStagedEdits && hasOpenInlineEditor ? (
        <PanelMessage tone="warning">
          Stage or cancel the open cell before applying the pending edits.
        </PanelMessage>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="relative w-full text-sm" style={{ tableLayout: "fixed" }}>
          <thead className="sticky -top-px z-10 border-b border-(--line) bg-zinc-900 text-left text-xs uppercase text-white shadow-[0_1px_0_var(--color-line)]">
            <tr>
              <th className="w-12 px-3 py-2 text-center align-middle">
                <SelectionCheckbox checked={allRowsSelected} onChange={() => {
                  setSelectedRowKeys(
                    allRowsSelected
                      ? new Set()
                      : new Set(displayedRows.map((row) => rowKeyFor(primaryKey, row as RowRecord))),
                  );
                }}
                />
              </th>
              {table.columns.map((column) => (
                <ResizableTh key={column.name}>
                  <button
                    type="button"
                    onClick={() =>
                      updateSearch(
                        view.orderColumn === column.name
                          ? view.orderDirection === "asc"
                            ? { order_column: column.name, order_direction: "desc" }
                            : { order_column: null, order_direction: null }
                          : { order_column: column.name, order_direction: "asc" },
                      )}
                    className="w-full cursor-pointer text-left transition"
                  >
                    <div className="flex items-center gap-1">
                      <span>{column.label}</span>
                      {view.orderColumn === column.name ? (
                        <span className="text-zinc-400">
                          {view.orderDirection === "desc" ? "↓" : "↑"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {columnTypeLabel(column)}
                    </div>
                  </button>
                  {column.relation ? (
                    <div className="mt-1 text-left text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {column.relation.displayName}.{column.relation.targetColumn}
                    </div>
                  ) : null}
                </ResizableTh>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--line)">
            {isPending ? (
              Array.from({ length: Math.max(10, displayedRows.length) }).map((_, index) => (
                <tr key={`skeleton-${index}`} className="group relative bg-zinc-900/10 transition">
                  <td className="w-12 border border-(--line) px-3 py-2 align-middle text-center">
                    <div className="mx-auto h-4 w-4 animate-pulse rounded-sm bg-zinc-800" />
                  </td>
                  {table.columns.map((column) => (
                    <td key={column.name} className="border border-(--line) px-3 py-4 align-middle">
                      <div
                        className="h-3 animate-pulse rounded bg-zinc-800"
                        style={{
                          width: `${Math.max(30, Math.random() * 80)}%`,
                          animationDelay: `${index * 0.05}s`,
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayedRows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length + 1} className="px-6 py-12 text-center text-sm text-(--muted)">
                  Empty
                </td>
              </tr>
            ) : (
              view.rows.map((row, index) => {
                const baseRow = row as RowRecord;
                const displayedRow = displayedRows[index] as RowRecord;
                const rowKey = rowKeyFor(primaryKey, baseRow);
                const isSelected = selectedRowKeys.has(rowKey);

                return (
                  <tr
                    key={`${rowKey}:${index}`}
                    className={`group relative transition ${isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-800/80"}`}
                  >
                    <td className="w-12 border border-(--line) px-3 py-2 align-middle text-center">
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() =>
                          setSelectedRowKeys((current) => {
                            const next = new Set(current);
                            if (next.has(rowKey)) {
                              next.delete(rowKey);
                            } else {
                              next.add(rowKey);
                            }
                            return next;
                          })}
                      />
                    </td>
                    {table.columns.map((column) => {
                      const currentEditKey = inlineEditKey(rowKey, column.name);
                      const stagedEdit = stagedEditsByKey.get(currentEditKey);
                      const isEditingThisCell =
                        editingCell?.rowKey === rowKey && editingCell?.columnName === column.name;

                      return (
                        <td
                          key={column.name}
                          className={`relative border border-(--line) px-3 py-2 align-middle text-zinc-200 ${stagedEdit ? "bg-emerald-500/10" : ""}`}
                        >
                          {isEditingThisCell ? (
                            <InlineCellEditor
                              column={column}
                              row={displayedRow}
                              onClose={() => setEditingCell(null)}
                              onStage={(formData) =>
                                stageInlineEdit(rowKey, column, baseRow[column.name], formData)}
                            />
                          ) : (
                            <div
                              className="min-h-6 w-full overflow-hidden whitespace-nowrap"
                              onDoubleClick={() => {
                                if (table.supportsCrud && column.name !== table.primaryKey) {
                                  setEditingCell({ rowKey, columnName: column.name });
                                  setInlineError(null);
                                }
                              }}
                            >
                              <CopyValue value={displayedRow[column.name]} />
                              {stagedEdit ? (
                                <span className="absolute top-1 right-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-emerald-200">
                                  Pending
                                </span>
                              ) : null}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-6 py-5 text-sm text-(--muted)">
        <div>
          {view.page}/{view.totalPages}
        </div>
        <div className="flex items-center gap-2">
          {view.page > 1 ? (
            <button
              onClick={() => updateSearch({ page: String(view.page - 1) }, true)}
              disabled={isPending}
              className="rounded-xl border border-white/30 px-3 py-2 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Prev
            </button>
          ) : null}
          {view.page < view.totalPages ? (
            <button
              onClick={() => updateSearch({ page: String(view.page + 1) }, true)}
              disabled={isPending}
              className="rounded-xl border border-white/30 px-3 py-2 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          ) : null}
        </div>
      </div>

      {isCreating ? (
        <RowFormPanel
          table={table}
          mode="create"
          onCancel={() => setIsCreating(false)}
          initialValues={{}}
          action={createRowAction.bind(null, table.slug, searchParamsStr)}
        />
      ) : null}
      {isEditing && selectedRowKeys.size === 1 && selectedRow ? (
        <RowFormPanel
          table={table}
          mode="update"
          onCancel={() => setIsEditing(false)}
          initialValues={selectedRow as RowRecord}
          action={updateRowAction.bind(null, table.slug, firstSelectedKey!, searchParamsStr)}
        />
      ) : null}
    </div>
  );
}
