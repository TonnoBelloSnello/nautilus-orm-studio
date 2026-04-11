import { unstable_noStore as noStore } from "next/cache";

import { QueryPanel } from "@/components/studio/query-panel";
import { StudioShell } from "@/components/studio/studio-shell";
import { getSidebarTables } from "@/lib/nautilus/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function QueryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();

  const [tables, params] = await Promise.all([getSidebarTables(), searchParams]);
  const initialSql = Array.isArray(params.sql) ? params.sql[0] ?? "" : params.sql ?? "";

  return (
    <main className="flex min-h-full flex-1">
      <StudioShell tables={tables} queryActive>
        <QueryPanel
          initialState={{
            sql: initialSql.trim(),
            rows: [],
            columns: [],
            rowCount: 0,
            errorMessage: null,
            submitted: false,
          }}
        />
      </StudioShell>
    </main>
  );
}

