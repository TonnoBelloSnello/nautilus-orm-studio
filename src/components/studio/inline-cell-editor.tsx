"use client";

import { FieldControl } from "@/components/studio/field-control";
import type { ColumnDefinition } from "@/lib/nautilus/types";

export function InlineCellEditor({
  column,
  row,
  onClose,
  onStage,
}: {
  column: ColumnDefinition;
  row: Record<string, unknown>;
  onClose: () => void;
  onStage: (formData: FormData) => void;
}) {
  const handleKeyDown: React.KeyboardEventHandler<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  > = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <form
      action={onStage}
      className="absolute -top-3 -left-1 z-30 flex min-w-80 flex-col rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-2xl"
    >
      <input type="hidden" name="__inline_column" value={column.name} />
      <FieldControl
        column={column}
        value={row[column.name]}
        variant="inline"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <div className="text-[10px] text-zinc-400">
          <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">Enter</kbd> to stage,
          <span className="px-1" />
          <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono">Esc</kbd> to cancel
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400 transition hover:border-zinc-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-black transition hover:bg-zinc-200"
          >
            Stage
          </button>
        </div>
      </div>
    </form>
  );
}
