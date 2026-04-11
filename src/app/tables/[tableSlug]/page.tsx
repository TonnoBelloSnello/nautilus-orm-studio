import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { StudioShell } from "@/components/studio/studio-shell";
import { TablePanel } from "@/components/studio/table-panel";
import { buildTableView, getSidebarTables } from "@/lib/nautilus/crud";
import { getTable } from "@/lib/nautilus/metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function searchParamValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function intParamValue(value: string | undefined, fallback: number): number {
  return value ? Number.parseInt(value, 10) || fallback : fallback;
}

export default async function TablePage({
  params,
  searchParams,
}: {
  params: Promise<{ tableSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();

  const [{ tableSlug }, paramsMap] = await Promise.all([params, searchParams]);
  const table = await getTable(tableSlug);

  if (!table) notFound();

  const page = intParamValue(searchParamValue(paramsMap.page), 1);
  const pageSize = intParamValue(searchParamValue(paramsMap.page_size), 25);

  const [tables, view] = await Promise.all([
    getSidebarTables(),
    buildTableView(table.slug, {
      page,
      pageSize,
      filterText: searchParamValue(paramsMap.filter_text),
      filterColumn: searchParamValue(paramsMap.filter_column),
      filterOperator: searchParamValue(paramsMap.filter_operator),
      orderColumn: searchParamValue(paramsMap.order_column),
      orderDirection: searchParamValue(paramsMap.order_direction),
    }),
  ]);

  const bannerMessage = searchParamValue(paramsMap.error) ?? null;

  return (
    <main className="flex min-h-full flex-1">
      <StudioShell tables={tables} activeTableSlug={table.slug} bannerMessage={bannerMessage}>
        <TablePanel view={view} />
      </StudioShell>
    </main>
  );
}
