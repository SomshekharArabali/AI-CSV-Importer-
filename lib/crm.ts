import { CRM_STATUS_VALUES, DATA_SOURCE_VALUES } from "@/lib/types";

/**
 * Column order + display labels for the "Parsed CRM records" table
 * (Step 4). Keeping this in one place means the table, the CSV export,
 * and the AI prompt can all stay in sync.
 */
export const crmFieldLabels: Record<string, string> = {
  created_at: "Created At",
  name: "Name",
  email: "Email",
  country_code: "Country Code",
  mobile_without_country_code: "Mobile",
  company: "Company",
  city: "City",
  state: "State",
  country: "Country",
  lead_owner: "Lead Owner",
  crm_status: "CRM Status",
  crm_note: "CRM Note",
  data_source: "Data Source",
  possession_time: "Possession Time",
  description: "Description"
};

export const crmFieldOrder = Object.keys(crmFieldLabels);

export const CRM_STATUS_OPTIONS = CRM_STATUS_VALUES;
export const DATA_SOURCE_OPTIONS = DATA_SOURCE_VALUES;
