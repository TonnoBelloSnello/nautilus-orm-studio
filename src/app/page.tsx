import { unstable_noStore as noStore } from "next/cache";

import { StudioShell } from "@/components/studio/studio-shell";
import { SchemaDiagram } from "@/components/studio/schema-diagram";
import { getSidebarTables } from "@/lib/nautilus/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  noStore();

  const tables = await getSidebarTables();

  return (
    <main className="flex min-h-full flex-1">
      <StudioShell tables={tables} diagramActive={true}>
        <SchemaDiagram tables={tables} />
      </StudioShell>
    </main>
  );
}

