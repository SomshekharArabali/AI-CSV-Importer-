import type { ImportApiResponse } from "@/lib/types";

/** Renders a cell value for the preview/result tables, falling back to "-". */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }
  return String(value);
}

/** Builds the summary stat cards shown once an import finishes. */
export function summarizeResult(result: ImportApiResponse | null) {
  if (!result) {
    return null;
  }

  return [
    { label: "Total Imported", value: result.meta.importedCount },
    { label: "Total Skipped", value: result.meta.skippedCount },
    { label: "Processed", value: result.meta.processedCount },
    { label: "Batches", value: result.meta.batchCount }
  ];
}

/** Rounds a processed/total ratio to a 0-100 integer percentage. */
export function progressPercent(processed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  const pct = (processed / total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
