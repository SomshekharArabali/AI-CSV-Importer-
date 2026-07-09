"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { crmFieldLabels, crmFieldOrder } from "@/lib/crm";
import { splitNdjsonLines } from "@/lib/stream";
import { formatCell, progressPercent, summarizeResult } from "@/lib/ui-helpers";
import type { CRMRecord, ImportApiResponse, ImportStreamEvent, PreviewRow } from "@/lib/types";
import { ThemeToggle } from "@/components/theme-toggle";

const previewLimit = 50; // README performance note: first 50 rows shown in preview

interface ImportProgress {
  batchIndex: number;
  batchCount: number;
  processedRows: number;
  totalRows: number;
}

interface RetryNotice {
  batchIndex: number;
  batchCount: number;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

function ResultTable({ records }: { records: CRMRecord[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {crmFieldOrder.map((field) => (
              <th key={field}>{crmFieldLabels[field]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 ? (
            <tr>
              <td colSpan={crmFieldOrder.length} className="empty-row">
                No records matched the import rules.
              </td>
            </tr>
          ) : (
            records.map((record, index) => (
              <tr key={`${record.email}-${record.mobile_without_country_code}-${index}`}>
                {crmFieldOrder.map((field) => (
                  <td key={field}>{formatCell(record[field])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function PreviewTable({ headers, rows }: { headers: string[]; rows: PreviewRow[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {headers.map((header) => (
                <td key={`${index}-${header}`}>{formatCell(row[header])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Progress bar for the (usually brief) incremental CSV-parsing phase. */
function ParsingProgressBar({ percent, rowsParsed }: { percent: number; rowsParsed: number }) {
  return (
    <div className="progress-shell" role="status" aria-live="polite">
      <div className="progress-header">
        <span>Reading CSV&hellip;</span>
        <span>
          {rowsParsed} row{rowsParsed === 1 ? "" : "s"} parsed &middot; {percent}%
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** Progress bar for the batched-AI-extraction phase, with a retry notice. */
function ImportProgressBar({
  progress,
  retryNotice
}: {
  progress: ImportProgress;
  retryNotice: RetryNotice | null;
}) {
  const pct = progressPercent(progress.processedRows, progress.totalRows);

  return (
    <div className="progress-shell" role="status" aria-live="polite">
      <div className="progress-header">
        <span>
          Batch {Math.min(progress.batchIndex, progress.batchCount)} of {progress.batchCount}
        </span>
        <span>
          {progress.processedRows} / {progress.totalRows} rows &middot; {pct}%
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {retryNotice ? (
        <p className="retry-notice">
          Batch {retryNotice.batchIndex} hit an error ({retryNotice.reason}) — retrying, attempt{" "}
          {retryNotice.attempt + 1} of {retryNotice.maxAttempts}&hellip;
        </p>
      ) : (
        <p className="helper-text">AI is mapping your CSV rows into CRM fields...</p>
      )}
    </div>
  );
}

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewRowCount, setPreviewRowCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportApiResponse | null>(null);
  const [parsingProgress, setParsingProgress] = useState<{
    percent: number;
    rowsParsed: number;
  } | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [retryNotice, setRetryNotice] = useState<RetryNotice | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  const summaryCards = summarizeResult(result);

  const parsePreview = (file: File) => {
    setPreviewError(null);
    setResult(null);
    setParsingProgress(null);
    setProgress(null);
    setRetryNotice(null);

    Papa.parse<PreviewRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (parsed) => {
        const headers = parsed.meta.fields?.filter(Boolean) ?? [];
        const rows = parsed.data.filter((row) =>
          Object.values(row).some((value) => String(value ?? "").trim() !== "")
        );

        if (headers.length === 0 || rows.length === 0) {
          setPreviewError("This CSV does not contain readable rows.");
          setPreviewHeaders([]);
          setPreviewRows([]);
          setPreviewRowCount(0);
          return;
        }

        setPreviewHeaders(headers);
        setPreviewRowCount(rows.length);
        setPreviewRows(rows.slice(0, previewLimit));
      },
      error: () => {
        setPreviewError("We could not parse that CSV. Please upload a valid file.");
        setPreviewHeaders([]);
        setPreviewRows([]);
        setPreviewRowCount(0);
      }
    });
  };

  const handleFile = (file: File | null) => {
    if (!file) {
      return;
    }

    const isCsv =
      file.type === "text/csv" ||
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "application/vnd.ms-excel";

    if (!isCsv) {
      setPreviewError("Please upload a valid CSV file.");
      return;
    }

    setSelectedFile(file);
    parsePreview(file);
  };

  const handleSubmit = async () => {
    if (!selectedFile) {
      return;
    }

    startTransition(() => {
      void (async () => {
        setPreviewError(null);
        setResult(null);
        setParsingProgress(null);
        setProgress(null);
        setRetryNotice(null);

        try {
          const formData = new FormData();
          formData.append("file", selectedFile);

          const response = await fetch("/api/import", {
            method: "POST",
            body: formData
          });

          const contentType = response.headers.get("Content-Type") ?? "";

          // Early validation failures (bad file, empty CSV, etc.) come back
          // as a single plain JSON error instead of a stream.
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { error?: string };
            throw new Error(payload.error || "Import failed.");
          }

          if (!response.ok || !response.body) {
            throw new Error("Import failed. Please try again.");
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let finalResult: ImportApiResponse | null = null;
          let streamError: string | null = null;

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const { events, remainder } = splitNdjsonLines<ImportStreamEvent>(buffer);
            buffer = remainder;

            for (const event of events) {
              if (event.type === "parsing") {
                setParsingProgress({ percent: event.percent, rowsParsed: event.rowsParsed });
              } else if (event.type === "start") {
                setParsingProgress(null);
                setProgress({
                  batchIndex: 0,
                  batchCount: event.batchCount,
                  processedRows: 0,
                  totalRows: event.totalRows
                });
              } else if (event.type === "retrying") {
                setRetryNotice({
                  batchIndex: event.batchIndex,
                  batchCount: event.batchCount,
                  attempt: event.attempt,
                  maxAttempts: event.maxAttempts,
                  reason: event.reason
                });
              } else if (event.type === "progress") {
                setRetryNotice(null);
                setProgress({
                  batchIndex: event.batchIndex,
                  batchCount: event.batchCount,
                  processedRows: event.processedRows,
                  totalRows: event.totalRows
                });
              } else if (event.type === "complete") {
                const { type: _type, ...rest } = event;
                finalResult = rest;
              } else if (event.type === "error") {
                streamError = event.message;
              }
            }
          }

          if (streamError) {
            throw new Error(streamError);
          }

          if (!finalResult) {
            throw new Error("Import finished without a result. Please retry.");
          }

          setResult(finalResult);
        } catch (error) {
          setResult(null);
          setPreviewError(
            error instanceof Error ? error.message : "Import failed. Please try again."
          );
        } finally {
          setParsingProgress(null);
          setProgress(null);
          setRetryNotice(null);
        }
      })();
    });
  };

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-top">
          <p className="eyebrow">GrowEasy Assignment</p>
          <ThemeToggle />
        </div>
        <h1>AI CSV importer for messy lead exports.</h1>
        <p className="hero-copy">
          Upload any valid lead CSV, preview it instantly, confirm when you&apos;re ready, and
          let the backend intelligently map records into GrowEasy CRM fields with AI.
        </p>
      </section>

      <section className="panel">
        <div
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            handleFile(event.dataTransfer.files[0] ?? null);
          }}
        >
          <input
            id="csv-upload"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
          />
          <label htmlFor="csv-upload">
            <span className="upload-badge">Step 1</span>
            <strong>Drag & drop your CSV here</strong>
            <span>or choose a file from your device</span>
          </label>
          {selectedFile ? (
            <p className="file-meta">
              Selected: {selectedFile.name} ({Math.max(1, Math.round(selectedFile.size / 1024))}
              KB)
            </p>
          ) : null}
        </div>

        {previewError ? <p className="error-banner">{previewError}</p> : null}

        <div className="section-header">
          <div>
            <p className="eyebrow">Step 2</p>
            <h2>Preview uploaded rows</h2>
          </div>
          <span className="helper-text">No AI processing happens yet.</span>
        </div>

        {previewHeaders.length > 0 ? (
          <>
            <PreviewTable headers={previewHeaders} rows={previewRows} />
            <div className="action-row">
              <p className="helper-text">
                Showing {previewRows.length} of {previewRowCount} row
                {previewRowCount === 1 ? "" : "s"} for review before import.
              </p>
              <button onClick={handleSubmit} disabled={isPending}>
                {isPending ? "Importing..." : "Confirm Import"}
              </button>
            </div>
            {isPending && parsingProgress ? (
              <ParsingProgressBar
                percent={parsingProgress.percent}
                rowsParsed={parsingProgress.rowsParsed}
              />
            ) : null}
            {isPending && progress ? (
              <ImportProgressBar progress={progress} retryNotice={retryNotice} />
            ) : null}
          </>
        ) : (
          <div className="placeholder-card">
            Upload a CSV to unlock the preview table and import action.
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Step 3 &amp; 4</p>
            <h2>Parsed CRM records</h2>
          </div>
          <span className="helper-text">Structured AI output from the backend.</span>
        </div>

        {summaryCards ? (
          <div className="stats-grid">
            {summaryCards.map((item) => (
              <article key={item.label} className="stat-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </article>
            ))}
          </div>
        ) : null}

        {result ? (
          <>
            <ResultTable records={result.records} />
            {result.skipped.length > 0 ? (
              <div className="skipped-shell">
                <h3>Skipped records ({result.skipped.length})</h3>
                <ul>
                  {result.skipped.map((item, index) => (
                    <li key={`${item.rowNumber}-${index}`}>
                      Row {item.rowNumber}: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <div className="placeholder-card">
            Imported records will appear here after confirmation.
          </div>
        )}
      </section>
    </main>
  );
}
