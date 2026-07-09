import { describe, expect, it } from "vitest";
import { crmFieldLabels, crmFieldOrder, CRM_STATUS_OPTIONS, DATA_SOURCE_OPTIONS } from "@/lib/crm";
import { emptyRecord } from "@/lib/import-helpers";

describe("crmFieldOrder", () => {
  it("has a label for every field", () => {
    for (const field of crmFieldOrder) {
      expect(crmFieldLabels[field]).toBeTruthy();
    }
  });

  it("matches exactly the keys produced by emptyRecord", () => {
    const recordKeys = Object.keys(emptyRecord()).sort();
    expect([...crmFieldOrder].sort()).toEqual(recordKeys);
  });
});

describe("enum options", () => {
  it("re-exports a non-empty set of crm_status values", () => {
    expect(CRM_STATUS_OPTIONS.length).toBeGreaterThan(0);
  });

  it("re-exports a non-empty set of data_source values", () => {
    expect(DATA_SOURCE_OPTIONS.length).toBeGreaterThan(0);
  });
});
