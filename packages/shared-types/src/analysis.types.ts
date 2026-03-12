export type IssueImpact = "critical" | "high" | "medium" | "low";
export type ReadinessBadge = "not-ready" | "needs-work" | "mostly-ready" | "ready";

export interface Issue {
  id: string;
  summary: string;
  description: string;
  impact: IssueImpact;
  recommendation: string;
  affectedArea?: string;
}

export interface AnalysisResult {
  jobId: string;
  notionPageId: string;
  issueCount: number;
  badge: ReadinessBadge;
  issues: Issue[];
  analyzedAt: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface RepoMeta {
  totalFiles: number;
  totalChars: number;
}

export interface RepoContext {
  name: string;
  files: RepoFile[];
  meta: RepoMeta;
}

export interface AnalysisRequest {
  notionPageId: string;
  prdText: string;
  repo: RepoContext;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobState {
  jobId: string;
  status: JobStatus;
  stage?: number;
  stageLabel?: string;
  result?: AnalysisResult;
  error?: string;
  message?: string;
}
