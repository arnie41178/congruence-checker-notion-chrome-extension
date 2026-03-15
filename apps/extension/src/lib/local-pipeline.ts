import type { RepoContext, RepoFile, AnalysisResult, Issue, Scorecard } from "@alucify/shared-types";
import AUDIT_AGENT_RAW from "../agents/prd-auditor.md?raw";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PrdEntities {
  entities: string[];
  apiEndpoints: string[];
  userFlows: string[];
  techRequirements: string[];
  integrations: string[];
}

interface RepoIndex {
  fileCount: number;
  fileTree: string;
  routes: string[];
  models: string[];
  services: string[];
  keyFileContents: string;
}

export interface LocalJobProgress {
  stage: number;
  stageLabel: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-4-6";

const STAGE_LABELS = [
  "Extracting PRD intent...",
  "Scanning repository...",
  "Auditing PRD against codebase...",
  "Compiling results...",
];

const PRD_EXTRACTION_SYSTEM = `You are a technical analyst specializing in product requirements documents (PRDs).
Your task is to extract structured technical requirements from a PRD.

Extract and return a JSON object with these fields:
- entities: string[] — domain model names (User, Order, Cart, Payment, etc.)
- apiEndpoints: string[] — API routes mentioned (e.g. POST /api/checkout, GET /users/:id)
- userFlows: string[] — named user journeys or features (e.g. "User Registration", "Checkout Flow")
- techRequirements: string[] — specific technical requirements (e.g. "real-time updates", "OAuth2 login")
- integrations: string[] — external services mentioned (e.g. Stripe, SendGrid, Firebase)

Return ONLY valid JSON. No markdown, no explanation.`;

// ── Agent prompt loading ───────────────────────────────────────────────────────

function loadAuditSystemPrompt(): string {
  // Strip YAML frontmatter (--- ... ---) and return the body
  const match = AUDIT_AGENT_RAW.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1].trim() : AUDIT_AGENT_RAW.trim();
}

// ── Anthropic API call ────────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  system: string,
  userContent: string,
  maxTokens: number
): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }

  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.type === "text" ? data.content[0].text : "";
}

async function callAnthropicWithRetry(
  apiKey: string,
  system: string,
  userContent: string,
  maxTokens: number
): Promise<string> {
  const MAX_RETRIES = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callAnthropic(apiKey, system, userContent, maxTokens);
    } catch (err: unknown) {
      lastErr = err;
      const msg = String(err);
      const isTransient = msg.includes("529") || msg.includes("503") || msg.includes("502");
      if (isTransient) {
        const delay = attempt * 5000;
        console.warn(`[local-pipeline] Attempt ${attempt} failed, retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Stage 1: PRD entity extraction ────────────────────────────────────────────

async function extractPrdEntities(apiKey: string, prdText: string): Promise<PrdEntities> {
  const empty: PrdEntities = {
    entities: [], apiEndpoints: [], userFlows: [], techRequirements: [], integrations: [],
  };

  if (prdText.trim().length <= 50) return empty;

  try {
    const raw = await callAnthropic(
      apiKey,
      PRD_EXTRACTION_SYSTEM,
      `Extract technical requirements from this PRD:\n\n${prdText}`,
      2048
    );
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    return JSON.parse(cleaned) as PrdEntities;
  } catch (err) {
    console.warn("[local-pipeline] PRD extraction failed, continuing:", err);
    return empty;
  }
}

// ── Stage 2: Repo index (heuristic, no LLM) ───────────────────────────────────

const ROUTE_PATTERNS = [
  /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)/gi,
  /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`]([^'"`]+)/gi,
  /path\s*=\s*['"`]([^'"`]+)/gi,
  /route\s*=\s*['"`]([^'"`]+)/gi,
];

const MODEL_FILE_PATTERNS = [
  /\.(model|schema|entity|type|interface)\.(ts|js|py|go|java|rs)$/i,
  /models?\//i,
  /schemas?\//i,
  /entities?\//i,
  /types?\//i,
];

const SERVICE_FILE_PATTERNS = [
  /\.(service|controller|handler|resolver)\.(ts|js|py|go|java|rs)$/i,
  /services?\//i,
  /controllers?\//i,
  /handlers?\//i,
];

const KEY_FILE_PATTERNS = [
  /package\.json$/,
  /requirements\.txt$/,
  /go\.mod$/,
  /Cargo\.toml$/,
  /pyproject\.toml$/,
  /routes?\.(ts|js|py)$/i,
  /app\.(ts|js|py)$/i,
  /server\.(ts|js|py)$/i,
  /main\.(ts|js|py|go|rs)$/i,
  /index\.(ts|js)$/i,
  /README\.md$/i,
];

function buildRepoIndex(repo: RepoContext): RepoIndex {
  const { files } = repo;

  const fileTree = files.slice(0, 200).map((f) => f.path).join("\n");
  const routes = extractRoutes(files);
  const models = files.filter((f) => MODEL_FILE_PATTERNS.some((p) => p.test(f.path))).map((f) => f.path).slice(0, 50);
  const services = files.filter((f) => SERVICE_FILE_PATTERNS.some((p) => p.test(f.path))).map((f) => f.path).slice(0, 50);
  const keyFileContents = extractKeyFileContents(files);

  return { fileCount: files.length, fileTree, routes, models, services, keyFileContents };
}

function extractRoutes(files: RepoFile[]): string[] {
  const routes = new Set<string>();
  for (const file of files) {
    if (!/\.(ts|js|py|go|rb|php|java|rs)$/i.test(file.path)) continue;
    for (const pattern of ROUTE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(file.content)) !== null) {
        const route = match[2] ?? match[1];
        if (route && route.startsWith("/")) routes.add(route);
      }
    }
  }
  return Array.from(routes).slice(0, 100);
}

function extractKeyFileContents(files: RepoFile[]): string {
  const keyFiles = files.filter((f) => KEY_FILE_PATTERNS.some((p) => p.test(f.path)));
  const MAX_KEY_CHARS = 8_000;
  let result = "";
  for (const file of keyFiles) {
    const entry = `\n// --- ${file.path} ---\n${file.content.slice(0, 2000)}\n`;
    if (result.length + entry.length > MAX_KEY_CHARS) break;
    result += entry;
  }
  return result;
}

// ── Stage 3: PRD audit ────────────────────────────────────────────────────────

function buildAuditUserMessage(prdText: string, prdEntities: PrdEntities, repoIndex: RepoIndex): string {
  const entitySummary = [
    `Entities: ${prdEntities.entities.join(", ") || "none"}`,
    `API Endpoints: ${prdEntities.apiEndpoints.join(", ") || "none"}`,
    `User Flows: ${prdEntities.userFlows.join(", ") || "none"}`,
    `Tech Requirements: ${prdEntities.techRequirements.join(", ") || "none"}`,
    `Integrations: ${prdEntities.integrations.join(", ") || "none"}`,
  ].join("\n");

  const repoLines: string[] = [];
  repoLines.push(`File count: ${repoIndex.fileCount}`);
  repoLines.push(`\nFile tree:\n${repoIndex.fileTree.slice(0, 3000)}`);
  if (repoIndex.routes.length > 0) repoLines.push(`\nExisting API routes:\n${repoIndex.routes.join("\n")}`);
  if (repoIndex.models.length > 0) repoLines.push(`\nModel / schema files:\n${repoIndex.models.join("\n")}`);
  if (repoIndex.services.length > 0) repoLines.push(`\nService / controller files:\n${repoIndex.services.join("\n")}`);
  if (repoIndex.keyFileContents) repoLines.push(`\nKey file contents:\n${repoIndex.keyFileContents.slice(0, 6000)}`);

  return `## PRD Text
${prdText.slice(0, 30_000)}

## Extracted PRD Entities
${entitySummary}

## Repository Index
${repoLines.join("\n")}

Perform the PRD audit and return the full markdown audit report.`;
}

// ── Stage 4: Parse audit report → issues ─────────────────────────────────────

const SEVERITY_MAP: Record<string, Issue["impact"]> = {
  critical: "critical",
  major: "high",
  minor: "low",
};

const CATEGORY_AREA: Record<string, Issue["affectedArea"]> = {
  terminology: "other",
  conflict: "other",
  duplication: "other",
  missing: "other",
};

function extractField(block: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}\\*\\*:\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|$)`, "i");
  return block.match(re)?.[1]?.trim() ?? "";
}

function auditReportToIssues(markdownReport: string): Issue[] {
  const issues: Issue[] = [];
  const blocks = markdownReport.split(/^### Issue \d+\s*$/m).slice(1);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const title = extractField(block, "Title");
    if (!title) continue;

    const rawSeverity = extractField(block, "Severity").toLowerCase();
    const impact: Issue["impact"] = SEVERITY_MAP[rawSeverity] ?? "medium";

    const category = extractField(block, "Category").toLowerCase();
    const affectedArea: Issue["affectedArea"] = (CATEGORY_AREA[category] ?? "other") as Issue["affectedArea"];

    issues.push({
      id: `audit-${i + 1}`,
      summary: title.slice(0, 200),
      description: extractField(block, "Description").slice(0, 1000),
      impact,
      recommendation: extractField(block, "Resolution").slice(0, 1000),
      affectedArea,
      evidence: extractField(block, "Evidence").slice(0, 500) || undefined,
      risk: extractField(block, "Risk").slice(0, 500) || undefined,
    });
  }

  if (issues.length === 0 && markdownReport.length > 100) {
    const statusMatch = markdownReport.match(/\*\*Status\*\*:\s*(.+)/);
    const status = statusMatch?.[1]?.trim() ?? "NEEDS REVIEW";
    issues.push({
      id: "audit-1",
      summary: `PRD Audit: ${status}`,
      description: markdownReport.slice(0, 1000),
      impact: status.includes("MAJOR") ? "high" : "medium",
      recommendation: "Review full audit report for detailed findings.",
      affectedArea: "other",
    });
  }

  return issues.slice(0, 30);
}

function deriveBadge(issues: Issue[]): AnalysisResult["badge"] {
  if (issues.some((i) => i.impact === "critical")) return "not-ready";
  if (issues.some((i) => i.impact === "high")) return "needs-work";
  if (issues.length > 0) return "mostly-ready";
  return "ready";
}

function scorecardFromReport(markdownReport: string): Scorecard | undefined {
  const match = markdownReport.match(/## Scorecard\s*```json\s*([\s\S]*?)```/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as Scorecard;
  } catch {
    return undefined;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runLocalPipeline(
  jobId: string,
  notionPageId: string,
  prdText: string,
  repo: RepoContext,
  apiKey: string,
  onProgress: (update: LocalJobProgress) => void
): Promise<AnalysisResult> {
  // Stage 1
  onProgress({ stage: 1, stageLabel: STAGE_LABELS[0] });
  const prdEntities = await extractPrdEntities(apiKey, prdText);

  // Stage 2
  onProgress({ stage: 2, stageLabel: STAGE_LABELS[1] });
  const repoIndex = buildRepoIndex(repo);

  // Stage 3
  onProgress({ stage: 3, stageLabel: STAGE_LABELS[2] });
  const systemPrompt = loadAuditSystemPrompt();
  const auditReport = await callAnthropicWithRetry(
    apiKey,
    systemPrompt,
    buildAuditUserMessage(prdText, prdEntities, repoIndex),
    4096
  );

  // Stage 4
  onProgress({ stage: 4, stageLabel: STAGE_LABELS[3] });
  const issues = auditReportToIssues(auditReport);
  const badge = deriveBadge(issues);
  const scorecard = scorecardFromReport(auditReport);

  return {
    jobId,
    notionPageId,
    issueCount: issues.length,
    badge,
    issues,
    analyzedAt: new Date().toISOString(),
    ...(scorecard ? { scorecard } : {}),
  };
}
