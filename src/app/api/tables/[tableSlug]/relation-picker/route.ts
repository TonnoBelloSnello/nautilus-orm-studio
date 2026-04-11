import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";

import { getRelationPickerData } from "@/lib/nautilus/crud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ tableSlug: string }>;
  },
) {
  noStore();

  const { tableSlug } = await context.params;
  const payload = await getRelationPickerData(tableSlug);
  return NextResponse.json(payload);
}

