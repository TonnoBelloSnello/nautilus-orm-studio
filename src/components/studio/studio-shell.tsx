import Link from "next/link";
import type { ReactNode } from "react";

import type { TableDefinition } from "@/lib/nautilus/types";
import { SidebarNav } from "./sidebar-nav";

export function StudioShell({
  tables,
  activeTableSlug,
  queryActive = false,
  diagramActive = false,
  bannerMessage,
  children,
}: {
  tables: TableDefinition[];
  activeTableSlug?: string | null;
  queryActive?: boolean;
  diagramActive?: boolean;
  bannerMessage?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="flex max-h-screen flex-1 overflow-hidden border border-(--line) bg-(--panel) shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_80px_rgba(0,0,0,0.45)]">
      <aside className="hidden w-72 shrink-0 border-r border-(--line) bg-(--panel-2) lg:flex lg:flex-col">
        <div className="border-b border-(--line) px-6 py-5">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Nautilus studio</h1>
          <p className="mt-2 text-sm text-(--muted)">Live schema browsing.</p>
        </div>
        <SidebarNav>
          <Link
            href="/query"
            scroll={false}
            className={`rounded-2xl px-4 py-3 text-sm transition hover:bg-zinc-900/50 hover:text-white ${queryActive ? "bg-white text-black" : "text-(--muted)"}`}
          >
            <div className="font-medium">Raw SQL</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">Query console</div>
          </Link>

          {tables.length > 0 ? <div className="my-3 border-t border-(--line)" /> : null}

          {tables.map((table, index) => {
            const active = activeTableSlug === table.slug;
            return (
              <Link
                key={table.slug}
                href={`/tables/${table.slug}`}
                scroll={false}
                className={`${index > 0 ? "mt-2 " : ""} rounded-2xl px-4 py-3 text-sm transition hover:bg-zinc-900/50 hover:text-white ${active ? "bg-white text-black" : "text-(--muted)"}`}
              >
                <div className="font-medium">{table.displayName}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">
                  {table.columns.length} cols
                </div>
              </Link>
            );
          })}
        </SidebarNav>

        <div className="border-t border-(--line) p-3">
          <Link
            href="/"
            scroll={false}
            className={`block rounded-2xl px-4 py-3 text-sm transition hover:bg-zinc-900/50 hover:text-white ${diagramActive ? "bg-white text-black" : "text-(--muted)"}`}
          >
            <div className="font-medium">Schema diagram</div>
            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-zinc-500">React Flow</div>
          </Link>
        </div>
      </aside>

      <section id="content-panel" className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full max-h-screen flex-col">
          {bannerMessage ? (
            <div className="space-y-3 border-b border-(--line) px-6 py-5">
              <div className="rounded-[1.25rem] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {bannerMessage}
              </div>
            </div>
          ) : null}
          {children}
        </div>
      </section>
    </section>
  );
}

