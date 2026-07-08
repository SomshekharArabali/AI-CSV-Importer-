export const CRM_STATUS_VALUES = [
  "GOOD_LEAD_FOLLOW_UP",
  "DID_NOT_CONNECT",
  "BAD_LEAD",
  "SALE_DONE"
] as const;

export type CrmStatus = (typeof CRM_STATUS_VALUES)[number];

export const DATA_SOURCE_VALUES = [
  "leads_on_demand",
  "meridian_tower",
  "eden_park",
  "varah_swamy",
  "sarjapur_plots"
] as const;

export type DataSource = (typeof DATA_SOURCE_VALUES)[number] | "";

/**
 * GrowEasy CRM record shape. Every field is a plain string so it can round
 * trip through JSON / CSV cleanly. Unknown or unmapped fields come back as
 * an empty string rather than being omitted, so the table columns stay
 * stable across every row.
 */
export interface CRMRecord {
  created_at: string;
  name: string;
  email: string;
  country_code: string;
  mobile_without_country_code: string;
  company: string;
  city: string;
  state: string;
  country: string;
  lead_owner: string;
  crm_status: CrmStatus | "";
  crm_note: string;
  data_source: DataSource;
  possession_time: string;
  description: string;
  [key: string]: unknown;
}

export interface PreviewRow {
  [key: string]: unknown;
}

export interface SkippedRecord {
  rowNumber: number;
  reason: string;
  original: Record<string, unknown>;
}

export interface ImportApiResponse {
  records: CRMRecord[];
  skipped: SkippedRecord[];
  meta: {
    importedCount: number;
    skippedCount: number;
    processedCount: number;
    batchCount: number;
  };
}
