import { NextRequest } from "next/server";
import type { CRMRecord, ImportStreamEvent, SkippedRecord } from "@/lib/types";
import {
  BATCH_SIZE,
  MAX_BATCH_ATTEMPTS,
  MAX_FILE_BYTES,
  buildImportResponse,
  buildSystemPrompt,
  chunk,
  extractJsonArrayText,
  filterNonBlankRows,
  hasContactInfo,
  parseCsvIncremental,
  sanitizeRecord,
  withRetry,
  type BatchItemResult,
  type RawRow
} from "@/lib/import-helpers";

// gemini-2.5-flash is on Google's free tier (no credit card required) and is
// the most stable free Flash model as of mid-2026. Override with
// GROWEASY_AI_MODEL if you want a newer preview model instead.
const AI_MODEL = process.env.GROWEASY_AI_MODEL || "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent`;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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

/**
 * Calls Gemini for one batch, retrying up to MAX_BATCH_ATTEMPTS times with
 * backoff on failure (rate limits / transient network errors / a cut-off
 * response are all worth a retry before we give up on the batch). `onRetry`
 * lets the caller stream a "retrying" progress event to the client between
 * attempts.
 */
async function callGeminiWithRetry(
  batch: RawRow[],
  onRetry: (attempt: number, reason: string) => void
): Promise<BatchItemResult[]> {
  return withRetry(() => callGemini(batch), {
    maxAttempts: MAX_BATCH_ATTEMPTS,
    onRetry: (attempt, error) => {
      onRetry(attempt, error instanceof Error ? error.message : "AI extraction failed.");
    }
  });
}

export async function POST(request: NextRequest) {
  let text: string;

  // Only the cheap, purely-client-error checks fail fast with a plain JSON
  // response. Everything that takes real time (CSV parsing, AI batches)
  // happens inside the stream below so the client gets live progress.
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return jsonError("No file provided.", 400);
    }

    if (file.size > MAX_FILE_BYTES) {
      return jsonError("File is too large. Please upload a CSV under 10MB.", 400);
    }

    text = await file.text();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Import failed.", 500);
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ImportStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        // --- Incremental CSV parsing ---------------------------------
        // Rows are parsed one at a time (PapaParse "step" mode) instead of
        // all at once, so we can stream parsing progress for large files
        // instead of the connection going quiet during the parse.
        const { rows: allRows, fatalError } = parseCsvIncremental(text, (progress) => {
          send({ type: "parsing", rowsParsed: progress.rowsParsed, percent: progress.percent });
        });

        if (fatalError) {
          send({ type: "error", message: `Could not parse CSV: ${fatalError}` });
          return;
        }

        const rows = filterNonBlankRows(allRows);

        if (rows.length === 0) {
          send({ type: "error", message: "CSV file is empty or contains no readable data rows." });
          return;
        }

        // --- Batched AI extraction, with retry -------------------------
        const batches = chunk(rows, BATCH_SIZE);
        send({ type: "start", batchCount: batches.length, totalRows: rows.length });

        const records: CRMRecord[] = [];
        const skipped: SkippedRecord[] = [];
        let rowCursor = 0;

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          const batchStartIndex = rowCursor;
          let results: BatchItemResult[];

          try {
            results = await callGeminiWithRetry(batch, (attempt, reason) => {
              send({
                type: "retrying",
                batchIndex: batchIndex + 1,
                batchCount: batches.length,
                attempt,
                maxAttempts: MAX_BATCH_ATTEMPTS,
                reason
              });
            });
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
            send({
              type: "progress",
              batchIndex: batchIndex + 1,
              batchCount: batches.length,
              processedRows: rowCursor,
              totalRows: rows.length
            });
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

            if (!hasContactInfo(record)) {
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
          send({
            type: "progress",
            batchIndex: batchIndex + 1,
            batchCount: batches.length,
            processedRows: rowCursor,
            totalRows: rows.length
          });
        }

        const response = buildImportResponse(records, skipped, rows.length, batches.length);
        send({ type: "complete", ...response });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Import failed." });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
