import { describe, expect, it } from "vitest";
import { filterNonBlankRows, parseCsvIncremental } from "@/lib/import-helpers";

describe("parseCsvIncremental", () => {
  it("parses rows and headers from well-formed CSV", () => {
    const csv = "name,email\nAlice,alice@example.com\nBob,bob@example.com\n";
    const { rows, headers, fatalError } = parseCsvIncremental(csv);

    expect(fatalError).toBeNull();
    expect(headers).toEqual(["name", "email"]);
    expect(rows).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" }
    ]);
  });

  it("trims header whitespace", () => {
    const csv = " name , email \nAlice,alice@example.com\n";
    const { headers } = parseCsvIncremental(csv);
    expect(headers).toEqual(["name", "email"]);
  });

  it("reports incremental progress as rows are parsed", () => {
    const rows = Array.from(
      { length: 250 },
      (_, i) => `Person${i},person${i}@example.com`
    ).join("\n");
    const csv = `name,email\n${rows}\n`;

    const progressCalls: { rowsParsed: number; percent: number }[] = [];
    parseCsvIncremental(
      csv,
      (progress) => {
        progressCalls.push({ rowsParsed: progress.rowsParsed, percent: progress.percent });
      },
      100
    );

    // Called at rows 100, 200, and once more at completion (percent: 100).
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    expect(progressCalls[0].rowsParsed).toBe(100);
    expect(progressCalls[1].rowsParsed).toBe(200);
    const last = progressCalls[progressCalls.length - 1];
    expect(last.percent).toBe(100);

    // Percent should be non-decreasing across calls.
    for (let i = 1; i < progressCalls.length; i += 1) {
      expect(progressCalls[i].percent).toBeGreaterThanOrEqual(progressCalls[i - 1].percent);
    }
  });

  it("reports a fatal error for unrecoverable parse failures instead of throwing", () => {
    const bad = 'name,email\n"Alice,alice@example.com\nBob,bob@example.com\n';
    const { fatalError } = parseCsvIncremental(bad);
    expect(fatalError).toBeTruthy();
  });

  it("does not call onProgress after a fatal error", () => {
    const bad = 'name,email\n"Alice,alice@example.com\n';
    const progressCalls: unknown[] = [];
    parseCsvIncremental(bad, (p) => progressCalls.push(p), 1);
    // The final "100%" completion callback is skipped once fatalError is set.
    expect(progressCalls.every((p) => (p as { percent: number }).percent !== 100)).toBe(true);
  });
});

describe("filterNonBlankRows", () => {
  it("drops rows where every field is blank or whitespace-only", () => {
    const rows = [
      { name: "Alice", email: "alice@example.com" },
      { name: "", email: "" },
      { name: "   ", email: "\t" },
      { name: "Bob", email: "" }
    ];

    expect(filterNonBlankRows(rows)).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "" }
    ]);
  });

  it("returns an empty array when all rows are blank", () => {
    expect(filterNonBlankRows([{ a: "" }, { a: "  " }])).toEqual([]);
  });
});
