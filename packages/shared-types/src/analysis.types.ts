export interface Requirement {
  id: string;           // "R001", "R002", ...
  title: string;
  description: string;
  type: "functional" | "non-functional" | "constraint";
  priority: "must-have" | "should-have" | "nice-to-have";
  prd_excerpts?: string[];
}

export interface PrdRequirements {
  version: number;
  extractedAt: string;  // ISO timestamp
  requirements: Requirement[];
}

export type IssueImpact = "critical" | "high" | "medium" | "low";
export type ReadinessBadge = "not-ready" | "needs-work" | "mostly-ready" | "ready";

export interface CategoryScore {
  score: number;         // 0–10
  summary: string;       // 1–2 sentence description
  suggestions: string[]; // top 2–3 action items
}

export interface Scorecard {
  overallScore: number;
  overallSummary: string;
  topPriorities: string[];
  categories: {
    terminology: CategoryScore;
    conflicts: CategoryScore;
    duplication: CategoryScore;
    missing: CategoryScore;
  };
}

export interface DiffHunk {
  sectionTitle: string; // PRD section this hunk applies to
  before: string;       // original PRD text to replace (empty string = pure addition)
  after: string;        // suggested replacement / addition
}

export interface Issue {
  id: string;
  summary: string;
  description: string;
  impact: IssueImpact;
  recommendation: string;
  affectedArea?: string;
  evidence?: string;
  risk?: string;
  suggestion?: string;  // 1-sentence fix description
  diffs?: DiffHunk[];   // 0–3 PRD text hunks to change
  accepted?: boolean;   // UI state: default true
}

export interface AnalysisResult {
  jobId: string;
  notionPageId: string;
  issueCount: number;
  badge: ReadinessBadge;
  issues: Issue[];
  analyzedAt: string;
  scorecard?: Scorecard;
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
