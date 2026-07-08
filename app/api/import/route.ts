import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import {
  CRM_STATUS_VALUES,
  DATA_SOURCE_VALUES,
  type CRMRecord,
  type ImportApiResponse,
  type SkippedRecord
} from "@/lib/types";
import { crmFieldOrder } from "@/lib/crm";

const BATCH_SIZE = 25;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
// gemini-2.5-flash is on Google's free tier (no credit card required) and is
// the most stable free Flash model as of mid-2026. Override with
// GROWEASY_AI_MODEL if you want a newer preview model instead.
const AI_MODEL = process.env.GROWEASY_AI_MODEL || "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;

type RawRow = Record<string, unknown>;

interface BatchItemResult {
  skip?: boolean;
  reason?: string;
  record?: Partial<CRMRecord>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function emptyRecord(): CRMRecord {
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

function buildSystemPrompt(): string {
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

function extractJsonArrayText(raw: string): string {
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

async function callGemini(batch: RawRow[]): Promise<BatchItemResult[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server. Set it in your environment (a free key is available at https://aistudio.google.com/apikey) to enable AI extraction."
    );
  }

  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: buildSystemPrompt() }]
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Here is the JSON array of raw rows to map (length: ${batch.length}):\n${JSON.stringify(
                batch
              )}`
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `AI extraction request failed (${response.status}): ${errorBody.slice(0, 500)}`
    );
  }

  const data = await response.json();

  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    throw new Error(`AI extraction was cut off (finishReason: ${finishReason}).`);
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  const rawText: string = Array.isArray(parts)
    ? parts.map((part: { text?: string }) => part.text ?? "").join("\n")
    : "";

  if (!rawText.trim()) {
    throw new Error("AI response was empty. Please retry the import.");
  }

  const jsonText = extractJsonArrayText(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI response was not valid JSON. Please retry the import.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI response was not a JSON array as expected.");
  }

  return parsed as BatchItemResult[];
}

function sanitizeRecord(candidate: Partial<CRMRecord>): CRMRecord {
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File is too large. Please upload a CSV under 10MB." },
        { status: 400 }
      );
    }

    const text = await file.text();

    const parsed = Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => header.trim()
    });

    if (parsed.errors?.length) {
      const fatal = parsed.errors.find((error) => error.type !== "FieldMismatch");
      if (fatal) {
        return NextResponse.json(
          { error: `Could not parse CSV: ${fatal.message}` },
          { status: 400 }
        );
      }
    }

    const rows = parsed.data.filter((row) =>
      Object.values(row).some((value) => String(value ?? "").trim() !== "")
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "CSV file is empty or contains no readable data rows." },
        { status: 400 }
      );
    }

    const batches = chunk(rows, BATCH_SIZE);
    const records: CRMRecord[] = [];
    const skipped: SkippedRecord[] = [];

    let rowCursor = 0;

    for (const batch of batches) {
      const batchStartIndex = rowCursor;
      let results: BatchItemResult[];

      try {
        results = await callGemini(batch);
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI extraction failed.";
        batch.forEach((row, offset) => {
          skipped.push({
            rowNumber: batchStartIndex + offset + 2,
            reason: message,
            original: row
          });
        });
        rowCursor += batch.length;
        continue;
      }

      if (results.length !== batch.length) {
        while (results.length < batch.length) {
          results.push({ skip: true, reason: "AI did not return a result for this row." });
        }
      }

      batch.forEach((row, offset) => {
        const rowNumber = batchStartIndex + offset + 2; // +2: header is row 1
        const item = results[offset];

        if (!item || item.skip) {
          skipped.push({
            rowNumber,
            reason: item?.reason || "Row has neither an email nor a mobile number.",
            original: row
          });
          return;
        }

        const record = sanitizeRecord(item.record ?? (item as Partial<CRMRecord>));

        if (!record.email && !record.mobile_without_country_code) {
          skipped.push({
            rowNumber,
            reason: "Row has neither an email nor a mobile number.",
            original: row
          });
          return;
        }

        records.push(record);
      });

      rowCursor += batch.length;
    }

    const response: ImportApiResponse = {
      records,
      skipped,
      meta: {
        importedCount: records.length,
        skippedCount: skipped.length,
        processedCount: rows.length,
        batchCount: batches.length
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Import failed." },
      { status: 500 }
    );
  }
}
