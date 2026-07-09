import { describe, expect, it } from "vitest";
import {
  buildImportResponse,
  buildSystemPrompt,
  chunk,
  emptyRecord,
  extractJsonArrayText,
  hasContactInfo,
  sanitizeRecord
} from "@/lib/import-helpers";
import { crmFieldOrder } from "@/lib/crm";
import type { SkippedRecord } from "@/lib/types";

describe("chunk", () => {
  it("splits an array into batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when size is larger than the input", () => {
    expect(chunk(["a", "b"], 25)).toEqual([["a", "b"]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 25)).toEqual([]);
  });

  it("throws for a non-positive size", () => {
    expect(() => chunk([1, 2], 0)).toThrow();
    expect(() => chunk([1, 2], -1)).toThrow();
  });
});

describe("emptyRecord", () => {
  it("has every CRM field defaulted to an empty string", () => {
    const record = emptyRecord();
    for (const field of crmFieldOrder) {
      expect(record[field as keyof typeof record]).toBe("");
    }
  });
});

describe("extractJsonArrayText", () => {
  it("extracts JSON from a fenced ```json code block", () => {
    const raw = '```json\n[{"a":1}]\n```';
    expect(extractJsonArrayText(raw)).toBe('[{"a":1}]');
  });

  it("extracts JSON from a generic fenced code block", () => {
    const raw = '```\n[1, 2, 3]\n```';
    expect(extractJsonArrayText(raw)).toBe("[1, 2, 3]");
  });

  it("extracts the array when surrounded by stray commentary", () => {
    const raw = 'Sure, here you go:\n[{"a":1}]\nHope that helps!';
    expect(extractJsonArrayText(raw)).toBe('[{"a":1}]');
  });

  it("returns the trimmed input when no array brackets are found", () => {
    expect(extractJsonArrayText("  not json at all  ")).toBe("not json at all");
  });
});

describe("sanitizeRecord", () => {
  it("fills in every CRM field and coerces values to strings", () => {
    const record = sanitizeRecord({ name: "Jane", possession_time: 2027 as unknown as string });
    expect(record.name).toBe("Jane");
    expect(record.possession_time).toBe("2027");
    expect(record.email).toBe("");
  });

  it("strips an invalid crm_status back to an empty string", () => {
    const record = sanitizeRecord({ crm_status: "NOT_A_REAL_STATUS" as never });
    expect(record.crm_status).toBe("");
  });

  it("keeps a valid crm_status", () => {
    const record = sanitizeRecord({ crm_status: "SALE_DONE" as never });
    expect(record.crm_status).toBe("SALE_DONE");
  });

  it("strips an invalid data_source back to an empty string", () => {
    const record = sanitizeRecord({ data_source: "made_up_source" as never });
    expect(record.data_source).toBe("");
  });

  it("keeps a valid data_source", () => {
    const record = sanitizeRecord({ data_source: "eden_park" as never });
    expect(record.data_source).toBe("eden_park");
  });

  it("treats null/undefined field values as empty strings, never null", () => {
    const record = sanitizeRecord({ name: null as never, company: undefined });
    expect(record.name).toBe("");
    expect(record.company).toBe("");
  });
});

describe("hasContactInfo", () => {
  it("is true when an email is present", () => {
    expect(hasContactInfo({ ...emptyRecord(), email: "a@b.com" })).toBe(true);
  });

  it("is true when a mobile number is present", () => {
    expect(hasContactInfo({ ...emptyRecord(), mobile_without_country_code: "9876543210" })).toBe(
      true
    );
  });

  it("is false when neither is present", () => {
    expect(hasContactInfo(emptyRecord())).toBe(false);
  });
});

describe("buildSystemPrompt", () => {
  it("includes every CRM field name so the model knows the exact schema", () => {
    const prompt = buildSystemPrompt();
    for (const field of crmFieldOrder) {
      expect(prompt).toContain(field);
    }
  });

  it("enumerates the allowed crm_status and data_source values", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("GOOD_LEAD_FOLLOW_UP");
    expect(prompt).toContain("eden_park");
  });
});

describe("buildImportResponse", () => {
  it("computes counts from the records/skipped arrays rather than trusting callers", () => {
    const records = [emptyRecord(), emptyRecord()];
    const skipped: SkippedRecord[] = [{ rowNumber: 3, reason: "no contact info", original: {} }];

    const response = buildImportResponse(records, skipped, 3, 1);

    expect(response.meta).toEqual({
      importedCount: 2,
      skippedCount: 1,
      processedCount: 3,
      batchCount: 1
    });
    expect(response.records).toBe(records);
    expect(response.skipped).toBe(skipped);
  });
});
