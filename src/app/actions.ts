"use server";

import { redirect } from "next/navigation";

import {
  AdminError,
  applyInlineEdits,
  createRow,
  deleteRow,
  PartialInlineApplyError,
  updateRow,
} from "@/lib/nautilus/crud";
import { runRawQuery } from "@/lib/nautilus/query";
import type {
  InlineEditActionResult,
  InlineEditOperation,
  QueryActionState,
  RowActionState,
} from "@/lib/nautilus/types";
import { userVisibleError } from "@/lib/nautilus/utils";

function actionErrorMessage(error: unknown): string {
  return error instanceof AdminError ? error.message : userVisibleError(error);
}

function formDataToValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    Array.from(formData.entries(), ([key, value]) => [key, String(value)]),
  );
}

function buildTableUrl(
  tableSlug: string,
  searchParamsStr: string,
  extraParams?: Record<string, string>,
): string {
  const search = new URLSearchParams(searchParamsStr);
  for (const [key, value] of Object.entries(extraParams ?? {})) {
    search.set(key, value);
  }
  const query = search.toString();
  return query ? `/tables/${tableSlug}?${query}` : `/tables/${tableSlug}`;
}

async function runRowAction(
  tableSlug: string,
  searchParamsStr: string,
  formData: FormData,
  action: () => Promise<unknown>,
): Promise<RowActionState> {
  try {
    await action();
  } catch (error) {
    return {
      errorMessage: actionErrorMessage(error),
      values: formDataToValues(formData),
    };
  }

  redirect(buildTableUrl(tableSlug, searchParamsStr));
}

async function redirectAfterMutation(
  tableSlug: string,
  searchParamsStr: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
    redirect(buildTableUrl(tableSlug, searchParamsStr));
  } catch (error) {
    redirect(buildTableUrl(tableSlug, searchParamsStr, { error: actionErrorMessage(error) }));
  }
}

export async function createRowAction(
  tableSlug: string,
  searchParamsStr: string,
  _previousState: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return runRowAction(tableSlug, searchParamsStr, formData, () => createRow(tableSlug, formData));
}

export async function updateRowAction(
  tableSlug: string,
  pk: string,
  searchParamsStr: string,
  _previousState: RowActionState,
  formData: FormData,
): Promise<RowActionState> {
  return runRowAction(tableSlug, searchParamsStr, formData, () => updateRow(tableSlug, pk, formData));
}

export async function applyInlineEditsAction(
  tableSlug: string,
  edits: InlineEditOperation[],
  useTransaction: boolean,
): Promise<InlineEditActionResult> {
  try {
    return {
      errorMessage: null,
      appliedCount: await applyInlineEdits(tableSlug, edits, { useTransaction }),
    };
  } catch (error) {
    return {
      errorMessage: actionErrorMessage(error),
      appliedCount: error instanceof PartialInlineApplyError ? error.appliedCount : 0,
    };
  }
}

export async function deleteRowsAction(
  tableSlug: string,
  pks: string[],
  searchParamsStr: string,
): Promise<void> {
  return redirectAfterMutation(tableSlug, searchParamsStr, async () => {
    for (const pk of pks) {
      await deleteRow(tableSlug, pk);
    }
  });
}

export async function deleteRowAction(
  tableSlug: string,
  pk: string,
  searchParamsStr: string,
): Promise<void> {
  return redirectAfterMutation(tableSlug, searchParamsStr, () => deleteRow(tableSlug, pk).then(() => undefined));
}

export async function runRawQueryAction(
  _previousState: QueryActionState,
  formData: FormData,
): Promise<QueryActionState> {
  return runRawQuery(String(formData.get("sql") ?? ""));
}
