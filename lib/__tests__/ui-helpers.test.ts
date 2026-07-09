import { describe, expect, it } from "vitest";
import { formatCell, progressPercent, summarizeResult } from "@/lib/ui-helpers";
import type { ImportApiResponse } from "@/lib/types";

describe("formatCell", () => {
  it("renders a dash for null, undefined, and blank values", () => {
    expect(formatCell(null)).toBe("-");
    expect(formatCell(undefined)).toBe("-");
    expect(formatCell("   ")).toBe("-");
  });

  it("stringifies non-empty values", () => {
    expect(formatCell("hello")).toBe("hello");
    expect(formatCell(42)).toBe("42");
  });
});

describe("summarizeResult", () => {
  it("returns null when there is no result yet", () => {
    expect(summarizeResult(null)).toBeNull();
  });

  it("maps the meta object into labeled stat cards", () => {
    const result: ImportApiResponse = {
      records: [],
      skipped: [],
      meta: { importedCount: 10, skippedCount: 2, processedCount: 12, batchCount: 1 }
    };

    expect(summarizeResult(result)).toEqual([
      { label: "Total Imported", value: 10 },
      { label: "Total Skipped", value: 2 },
      { label: "Processed", value: 12 },
      { label: "Batches", value: 1 }
    ]);
  });
});

describe("progressPercent", () => {
  it("computes a rounded percentage", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 4)).toBe(50);
  });

  it("returns 0 when total is 0 or negative", () => {
    expect(progressPercent(5, 0)).toBe(0);
    expect(progressPercent(5, -1)).toBe(0);
  });

  it("clamps to the 0-100 range", () => {
    expect(progressPercent(0, 10)).toBe(0);
    expect(progressPercent(10, 10)).toBe(100);
    expect(progressPercent(15, 10)).toBe(100);
  });
});
