"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/studio/modal";

export function DeleteRowForm({
  action,
  count = 1,
}: {
  action: () => Promise<void>;
  count?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    startTransition(async () => {
      await action();
      setIsOpen(false);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-lg border border-red-500/65 px-2 py-1 text-[11px] tracking-wide text-red-300 transition hover:bg-red-500/10 cursor-pointer"
      >
        Delete{count > 1 ? ` (${count})` : ""}
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`Delete ${count > 1 ? "Rows" : "Row"}`}
        description={`Are you sure you want to delete ${count > 1 ? `these ${count} rows` : "this row"}? This action cannot be undone.`}
      >
        <div className="flex items-center justify-end gap-3 border-t border-(--line) px-6 py-4 bg-(--panel-2)">
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-2xl border border-(--line) px-4 py-2 text-sm text-(--muted) transition hover:border-zinc-500 hover:text-white cursor-pointer"
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isPending}
            className="rounded-2xl bg-red-500/90 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer"
          >
            {isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </Modal>
    </>
  );
}

