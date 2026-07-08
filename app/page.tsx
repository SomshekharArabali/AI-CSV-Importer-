"use client";

import { useState, useTransition } from "react";
import Papa from "papaparse";
import { crmFieldLabels, crmFieldOrder } from "@/lib/crm";
import type { CRMRecord, ImportApiResponse, PreviewRow } from "@/lib/types";
import { ThemeToggle } from "@/components/theme-toggle";

const previewLimit = 50; // README performance note: first 50 rows shown in preview

function formatCell(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }
  return String(value);
}

function summarizeResult(result: ImportApiResponse | null) {
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

export default function HomePage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewRowCount, setPreviewRowCount] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportApiResponse | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPending, startTransition] = useTransition();

  const summaryCards = summarizeResult(result);

  const parsePreview = (file: File) => {
    setPreviewError(null);
    setResult(null);

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

        try {
          const formData = new FormData();
          formData.append("file", selectedFile);

          const response = await fetch("/api/import", {
            method: "POST",
            body: formData
          });

          const payload = (await response.json()) as ImportApiResponse | { error: string };

          if (!response.ok || "error" in payload) {
            const message = "error" in payload ? payload.error : "Import failed.";
            throw new Error(message);
          }

          setResult(payload);
        } catch (error) {
          setResult(null);
          setPreviewError(
            error instanceof Error ? error.message : "Import failed. Please try again."
          );
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
