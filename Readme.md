# AI CSV Importer for GrowEasy CRM

A Next.js app that lets you upload a messy lead CSV, preview it, confirm the import, and
have an AI model (Claude) intelligently map whatever columns exist into the GrowEasy CRM
schema — batching requests, enforcing the CRM's enum rules, and reporting exactly what was
imported vs. skipped.

## How it matches the spec

**Step 1 — Upload CSV**
Drag & drop or file-picker upload of any valid CSV (`app/page.tsx`).

**Step 2 — Preview**
The CSV is parsed client-side with PapaParse and shown in a responsive table with a sticky
header, horizontal + vertical scrolling. No AI/network call happens at this step.

**Step 3 — Confirm Import**
Only once you click **Confirm Import** does the frontend `POST` the raw file to
`/api/import`.

**Step 4 — Display Parsed Result**
The backend returns AI-extracted CRM records plus a skipped list, and the UI shows both
tables along with total imported / total skipped counts.

## Backend

`app/api/import/route.ts`:

1. **Accepts any CSV** — column names are never assumed; PapaParse reads headers dynamically.
2. **Parses** the CSV into row objects (handles quoted fields, embedded commas, escaped
   newlines, etc.).
3. **Batches** rows (25 per batch) and sends each batch to Google's free-tier Gemini API
   (`GEMINI_API_KEY` env var) with a system prompt encoding all of the assignment's AI
   instructions:
   - Only the four allowed `crm_status` values are used (`GOOD_LEAD_FOLLOW_UP`,
     `DID_NOT_CONNECT`, `BAD_LEAD`, `SALE_DONE`); anything else is left blank.
   - Only the five allowed `data_source` values are used; anything uncertain is left blank.
   - `created_at` is required to be parseable via `new Date(created_at)`.
   - Extra remarks / follow-ups / extra emails / extra phone numbers all get folded into
     `crm_note`.
   - Multiple emails → first one becomes `email`, the rest go into `crm_note` (same rule for
     phone numbers).
   - Rows with neither an email nor a mobile number are skipped, with a reason.
4. **Returns structured JSON**: `records`, `skipped` (with row number + reason + original
   row), and `meta` (`importedCount`, `skippedCount`, `processedCount`, `batchCount`).

The route also sanitizes every AI response (rejecting any `crm_status`/`data_source` value
outside the allowed enums) and re-checks the skip rule itself as a safety net, so a bad model
response can't silently corrupt the CRM data.

## GrowEasy CRM fields

`created_at`, `name`, `email`, `country_code`, `mobile_without_country_code`, `company`,
`city`, `state`, `country`, `lead_owner`, `crm_status`, `crm_note`, `data_source`,
`possession_time`, `description` — see `lib/crm.ts` / `lib/types.ts` for the single source of
truth used by both the API and the UI table.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS v4 + custom CSS (`app/globals.css`)
- **CSV Parsing**: PapaParse (client preview + server-side parsing)
- **AI**: Google Gemini API (free tier), called directly via `fetch` — no SDK dependency
- **API**: Next.js Route Handlers

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (or npm/yarn)
- A free Google Gemini API key ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) — no credit card required

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd AI-CSV-Importer-
```

2. Install dependencies:
```bash
pnpm install
```

3. Configure your API key:
```bash
cp .env.example .env.local
# then edit .env.local and set GEMINI_API_KEY=AIza...
```

4. Start the development server:
```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Project Structure

```
├── app/
│   ├── page.tsx              # Upload → Preview → Confirm → Results UI
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles & theme (sticky headers, scroll, responsive)
│   └── api/
│       └── import/
│           └── route.ts      # CSV parsing + batched AI extraction endpoint
├── lib/
│   ├── crm.ts                # CRM field labels/order + allowed enum re-exports
│   ├── types.ts              # CRMRecord, enums, API response shapes
│   └── utils.ts              # Utility functions
└── public/                   # Static assets
```

## API

### `POST /api/import`

**Request:** `multipart/form-data` with a single `file` field (the CSV).

**Response:**
```json
{
  "records": [
    {
      "created_at": "2026-05-13 14:20:48",
      "name": "John Doe",
      "email": "john.doe@example.com",
      "country_code": "+91",
      "mobile_without_country_code": "9876543210",
      "company": "GrowEasy",
      "city": "Mumbai",
      "state": "Maharashtra",
      "country": "India",
      "lead_owner": "test@gmail.com",
      "crm_status": "GOOD_LEAD_FOLLOW_UP",
      "crm_note": "Client is asking to reschedule demo",
      "data_source": "",
      "possession_time": "",
      "description": ""
    }
  ],
  "skipped": [
    { "rowNumber": 5, "reason": "Row has neither an email nor a mobile number.", "original": { "...": "..." } }
  ],
  "meta": {
    "importedCount": 1,
    "skippedCount": 1,
    "processedCount": 2,
    "batchCount": 1
  }
}
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Used server-side to call the free-tier Gemini API. |
| `GROWEASY_AI_MODEL` | No | Overrides the model id (defaults to `gemini-2.5-flash`). |

## Performance

- **File size limit**: 10MB
- **AI batch size**: 25 rows per request to the model
- **Preview limit**: first 50 rows shown client-side before import

## Error Handling

- Invalid / non-CSV file uploads are rejected client-side before any network call.
- Malformed CSVs surface a clear parse error instead of a silent empty table.
- If the AI call for a batch fails (missing API key, network error, bad JSON), those rows are
  reported in `skipped` with the underlying error message rather than failing the whole
  import.
- `crm_status` and `data_source` values outside the allowed enums are stripped to an empty
  string server-side, regardless of what the model returned.

## License

MIT.
