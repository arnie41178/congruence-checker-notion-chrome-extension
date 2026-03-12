export type TelemetryEvent =
  | "extension_installed"
  | "extension_first_opened"
  | "extension_panel_opened"
  | "extension_panel_closed"
  | "extension_notion_page_detected"
  | "prd_page_detected"
  | "run_congruence_check_clicked"
  | "analysis_started"
  | "analysis_completed"
  | "analysis_results_viewed"
  | "issue_expanded";

export interface TelemetryProperties {
  clientId?: string;
  extensionVersion?: string;
  browser?: string;
  notionPageId?: string;
  wordCount?: number;
  jobId?: string;
  issueCount?: number;
  badge?: string;
  issueId?: string;
  [key: string]: unknown;
}
