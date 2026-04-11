"use client";

import { useActionState } from "react";

import { runRawQueryAction } from "@/app/actions";
import { CopyValue } from "@/components/studio/copy-value";
import type { QueryActionState } from "@/lib/nautilus/types";

export function QueryPanel({
  initialState,
}: {
  initialState: QueryActionState;
}) {
  const [state, action, pending] = useActionState(runRawQueryAction, initialState);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-(--line) px-6 py-5">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">Raw SQL</h2>
          <p className="mt-2 text-sm text-(--muted)">
            Run a query directly against the connected database.
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto px-6 py-6">
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="raw-sql-input" className="text-sm font-medium text-white">
              Query
            </label>
            <textarea
              id="raw-sql-input"
              name="sql"
              rows={10}
              spellCheck={false}
              defaultValue={state.sql}
              className="mt-2 w-full rounded-[1.25rem] border border-(--line) bg-(--panel-2) px-4 py-3 font-mono text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
              placeholder="SELECT * FROM users LIMIT 25;"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-[1.1rem] bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {pending ? "Running query" : "Run query"}
            </button>
          </div>
        </form>

        {state.errorMessage ? (
          <div className="rounded-[1.25rem] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {state.errorMessage}
          </div>
        ) : state.submitted ? (
          <div className="rounded-[1.25rem] border border-(--line) bg-(--panel-2) px-4 py-3 text-sm text-(--muted)">
            {state.rowCount} row{state.rowCount === 1 ? "" : "s"} returned.
          </div>
        ) : null}

        {state.columns.length > 0 ? (
          <div className="min-h-0 overflow-auto rounded-[1.25rem] border border-(--line)">
            <table className="min-w-full text-sm">
              <thead className="sticky -top-px z-10 border-b border-(--line) text-left text-xs uppercase text-white bg-zinc-900 shadow-[0_1px_0_var(--color-line)]">
                <tr>
                  {state.columns.map((column) => (
                    <th key={column} className="px-6 py-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {state.rows.map((row, index) => (
                  <tr key={index} className="transition hover:bg-zinc-900/50">
                    {state.columns.map((column) => (
                      <td key={column} className="max-w-[18rem] px-6 py-4 align-middle text-zinc-200">
                        <CopyValue value={row[column]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : state.submitted && !state.errorMessage ? (
          <div className="rounded-[1.25rem] border border-(--line) bg-(--panel-2) px-4 py-10 text-center text-sm text-(--muted)">
            Query executed successfully, but no rows were returned.
          </div>
        ) : null}
      </div>
    </div>
  );
}

