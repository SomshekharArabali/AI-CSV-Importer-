import { describe, expect, it } from "vitest";
import { splitNdjsonLines } from "@/lib/stream";

describe("splitNdjsonLines", () => {
  it("parses complete lines and returns no remainder when buffer ends in a newline", () => {
    const buffer = '{"a":1}\n{"b":2}\n';
    const { events, remainder } = splitNdjsonLines(buffer);
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
    expect(remainder).toBe("");
  });

  it("holds back an incomplete trailing line as the remainder", () => {
    const buffer = '{"a":1}\n{"partial":';
    const { events, remainder } = splitNdjsonLines(buffer);
    expect(events).toEqual([{ a: 1 }]);
    expect(remainder).toBe('{"partial":');
  });

  it("lets the caller resume parsing once the remainder is completed", () => {
    const first = splitNdjsonLines('{"a":1}\n{"b":');
    expect(first.events).toEqual([{ a: 1 }]);

    const second = splitNdjsonLines(`${first.remainder}2}\n`);
    expect(second.events).toEqual([{ b: 2 }]);
    expect(second.remainder).toBe("");
  });

  it("skips blank lines", () => {
    const buffer = '{"a":1}\n\n{"b":2}\n';
    const { events } = splitNdjsonLines(buffer);
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("returns no events for an empty buffer", () => {
    const { events, remainder } = splitNdjsonLines("");
    expect(events).toEqual([]);
    expect(remainder).toBe("");
  });
});
