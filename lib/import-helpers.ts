import Papa from "papaparse";
import {
  CRM_STATUS_VALUES,
  DATA_SOURCE_VALUES,
  type CRMRecord,
  type SkippedRecord,
  type ImportApiResponse
} from "@/lib/types";
import { crmFieldOrder } from "@/lib/crm";

export const BATCH_SIZE = 25;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

// Retry mechanism for failed AI batches: a batch is only skipped after this
// many attempts have all failed, with an exponential backoff between them.
export const MAX_BATCH_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 500;

export type RawRow = Record<string, unknown>;

export interface BatchItemResult {
  skip?: boolean;
  reason?: string;
  record?: Partial<CRMRecord>;
}

/** Splits `items` into consecutive chunks of at most `size` elements each. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error("chunk size must be a positive number");
  }

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/** A CRMRecord with every field defaulted to an empty string. */
export function emptyRecord(): CRMRecord {
  return {
    created_at: "",
    name: "",
    email: "",
    country_code: "",
    mobile_without_country_code: "",
    company: "",
    city: "",
    state: "",
    country: "",
    lead_owner: "",
    crm_status: "",
    crm_note: "",
    data_source: "",
    possession_time: "",
    description: ""
  };
}

export function buildSystemPrompt(): string {
  return `You are a data-mapping engine for the GrowEasy CRM. You will be given a JSON array of raw lead rows extracted from an arbitrary, messy CSV export. Column names are NOT fixed and may be abbreviated, misspelled, differently ordered, or absent.

Your job: for EACH input row (same order, same count), intelligently map whatever fields are available onto the GrowEasy CRM schema below, and return a JSON array of results (one result per input row, same order).

CRM FIELDS TO PRODUCE for a mapped row:
- created_at: lead creation date/time. Must be a string parseable by JavaScript's \`new Date(created_at)\`. Prefer ISO-like "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DDTHH:mm:ss". If no date is available, use an empty string.
- name: lead's full name (combine first/last name columns if separate).
- email: the lead's primary email address.
- country_code: phone country code, e.g. "+91". Infer from context when possible; otherwise empty string.
- mobile_without_country_code: the phone number WITHOUT the country code.
- company: company / organization name.
- city, state, country: location fields.
- lead_owner: the person/agent who owns this lead (often an email or username).
- crm_status: MUST be exactly one of ${CRM_STATUS_VALUES.join(", ")}. Infer from any status/remarks column. If nothing confidently matches, use an empty string.
- crm_note: remarks, follow-up notes, extra comments, extra phone numbers, extra email addresses, or any useful info that doesn't fit another field.
- data_source: MUST be exactly one of ${DATA_SOURCE_VALUES.join(", ")}. If nothing matches confidently, use an empty string. Do not invent new values.
- possession_time: property possession time, if present.
- description: any additional free-text description.

RULES:
1. Only use the allowed enum values listed above for crm_status and data_source (case-sensitive, exact match). If unsure, leave blank.
2. If a row has MULTIPLE email addresses: use the first as "email" and append the rest into "crm_note".
3. If a row has MULTIPLE mobile numbers: use the first as "mobile_without_country_code" (with country_code split out if identifiable) and append the rest into "crm_note".
4. Every value must be a plain string (use "" for unknown/missing, never null).
5. Keep each record's crm_note/description free of raw newlines; use "\\n" if you must represent a line break, so the value stays a single CSV/JSON-safe string.
6. SKIP a row if it has NEITHER an email address NOR a mobile number anywhere in its fields. For a skipped row, instead of a record, return {"skip": true, "reason": "<short human reason>"}.
7. Never fabricate data that is not present or reasonably inferable from the row.

OUTPUT FORMAT (critical):
Return ONLY a raw JSON array, with exactly one element per input row, in the same order. No markdown code fences, no commentary, no explanation text before or after.
Each element is EITHER:
  {"skip": true, "reason": "..."}
OR a full record object with EXACTLY these keys: ${crmFieldOrder.join(", ")}.`;
}

/**
 * Pulls the JSON array text out of a raw model response, tolerating
 * markdown code fences or stray commentary around the array.
 */
export function extractJsonArrayText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}

/**
 * Coerces an arbitrary AI-provided candidate object into a well-formed
 * CRMRecord: every known field becomes a string, and any crm_status /
 * data_source value outside the allowed enums is stripped back to "".
 */
export function sanitizeRecord(candidate: Partial<CRMRecord>): CRMRecord {
  const base = emptyRecord();
  for (const field of crmFieldOrder) {
    const value = candidate[field as keyof CRMRecord];
    base[field as keyof CRMRecord] = (
      value === null || value === undefined ? "" : String(value)
    ) as never;
  }

  if (!CRM_STATUS_VALUES.includes(base.crm_status as (typeof CRM_STATUS_VALUES)[number])) {
    base.crm_status = "";
  }
  if (
    base.data_source &&
    !DATA_SOURCE_VALUES.includes(base.data_source as (typeof DATA_SOURCE_VALUES)[number])
  ) {
    base.data_source = "";
  }

  return base;
}

/** True when a sanitized record has enough info to be worth importing. */
export function hasContactInfo(record: CRMRecord): boolean {
  return Boolean(record.email) || Boolean(record.mobile_without_country_code);
}

export function buildImportResponse(
  records: CRMRecord[],
  skipped: SkippedRecord[],
  processedCount: number,
  batchCount: number
): ImportApiResponse {
  return {
    records,
    skipped,
    meta: {
      importedCount: records.length,
      skippedCount: skipped.length,
      processedCount,
      batchCount
    }
  };
}

/**
 * Delay before retry attempt number `attempt` (1-based: the delay that
 * follows the 1st failed attempt, before the 2nd try, etc.). Simple
 * exponential backoff: 500ms, 1000ms, 2000ms, ...
 */
export function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

export interface WithRetryOptions {
  maxAttempts: number;
  /** Called after a failed attempt, before waiting to retry. Not called after the final attempt. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** Injectable so tests don't have to wait on real timers. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Retries `fn` up to `maxAttempts` times with exponential backoff,
 * re-throwing the last error once attempts are exhausted. Used to make a
 * single failed AI batch call resilient to transient errors (rate limits,
 * network blips) instead of immediately giving up on the whole batch.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetryOptions
): Promise<T> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < options.maxAttempts) {
        options.onRetry?.(attempt, error);
        await sleep(retryDelayMs(attempt));
      }
    }
  }
  throw lastError;
}

export interface CsvParseProgress {
  rowsParsed: number;
  /** Character offset PapaParse has consumed so far. */
  cursor: number;
  totalChars: number;
  /** 0-100, based on how much of the input text has been consumed. */
  percent: number;
}

export interface CsvParseResult {
  rows: RawRow[];
  headers: string[];
  /** Set when PapaParse hit an unrecoverable error (bad quoting, etc.). */
  fatalError: string | null;
}

/**
 * Parses CSV text incrementally (PapaParse's row-by-row "step" mode) rather
 * than all at once, so:
 *  - very large files don't need a second full-array pass just to report
 *    progress, and
 *  - the caller can stream parsing progress back to the client instead of
 *    the request going quiet while a big file is parsed.
 *
 * `onProgress` fires roughly every `progressEveryRows` rows (and once more
 * at 100% when parsing finishes), reporting how much of the input text has
 * been consumed.
 */
export function parseCsvIncremental(
  text: string,
  onProgress?: (progress: CsvParseProgress) => void,
  progressEveryRows = 100
): CsvParseResult {
  const totalChars = Math.max(text.length, 1);
  const rows: RawRow[] = [];
  let headers: string[] = [];
  let fatalError: string | null = null;
  let rowsParsed = 0;

  Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
    step: (results, parser) => {
      if (headers.length === 0 && results.meta.fields) {
        headers = results.meta.fields.filter(Boolean);
      }

      const fatal = results.errors?.find((error) => error.type !== "FieldMismatch");
      if (fatal) {
        fatalError = fatal.message;
        parser.abort();
        return;
      }

      rows.push(results.data);
      rowsParsed += 1;

      if (onProgress && rowsParsed % progressEveryRows === 0) {
        const cursor = results.meta.cursor ?? 0;
        onProgress({
          rowsParsed,
          cursor,
          totalChars,
          percent: Math.min(100, Math.round((cursor / totalChars) * 100))
        });
      }
    }
  });

  if (onProgress && !fatalError) {
    onProgress({ rowsParsed, cursor: totalChars, totalChars, percent: 100 });
  }

  return { rows, headers, fatalError };
}

/** Drops rows where every field is blank/whitespace-only. */
export function filterNonBlankRows(rows: RawRow[]): RawRow[] {
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}
