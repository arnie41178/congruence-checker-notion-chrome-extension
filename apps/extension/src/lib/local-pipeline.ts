import type { RepoContext, RepoFile, AnalysisResult, Issue, Scorecard, Requirement } from "@alucify/shared-types";
import REQUIREMENT_AUDITOR_RAW from "../agents/requirement-auditor.md?raw";

// ── Types ─────────────────────────────────────────────────────────────────────

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

/**
 * Abstraction over LLM invocation — either direct Anthropic API (API key)
 * or the Claude CLI via native messaging companion.
 */
export type ClaudeInvoker = (system: string, prompt: string, maxTokens?: number) => Promise<string>;

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGE_LABELS = [
  "Extracting requirements...",
  "Scanning repository...",
  "Auditing requirements...",
  "Compiling results...",
];

const REQUIREMENT_EXTRACTION_SYSTEM = `You are a senior product analyst specialising in breaking down Product Requirements Documents (PRDs) into coherent, self-contained requirements suitable for implementation review.

Your task is to read a PRD and extract requirements at a level that aligns with how engineering work is scoped and implemented — typically at a user story or feature slice level.

## Core Principle

Each requirement should represent a **self-contained unit of functionality** that an engineer could implement without requiring additional requirements to understand its behavior.

Avoid over-fragmentation into acceptance-criteria-level statements.

---

## Rules

- Each requirement must represent a **cohesive feature, user story, or workflow slice**.
- A requirement MAY include multiple behaviors if they are tightly related and required to understand the full flow.
- Do NOT split requirements into overly granular acceptance criteria.
- Ensure each requirement is **independently understandable and analyzable**.

- Do NOT paraphrase unnecessarily — stay close to the PRD language, but you may consolidate closely related statements into a single coherent requirement.

- Assign a sequential ID starting at R001.

- Classify each requirement:
  - type:
    - "functional" → user-facing behavior or system capability
    - "non-functional" → performance, reliability, security, scalability, etc.
    - "constraint" → explicit limitations (tech stack, compliance, scope boundaries)

  - priority:
    - "must-have" → required for core functionality or launch
    - "should-have" → important but not blocking
    - "nice-to-have" → optional or future consideration

---

## PRD Excerpts (Critical)

For each requirement, include the **supporting excerpts from the PRD** that justify the requirement.

- Add a field: \`"prd_excerpts"\` as an array of strings.
- Each excerpt must be a **verbatim quote from the PRD** (no paraphrasing).
- Include **all relevant portions of the PRD** needed to fully understand the requirement.
- If a requirement is derived from multiple parts of the PRD, include all such excerpts.
- Excerpts can include full paragraphs or sections if they contribute meaningfully to the requirement.
- Do NOT invent or infer excerpts — only include text explicitly present in the PRD.

---

## Output format

Return ONLY a valid JSON object with this exact shape — no markdown, no explanation:

{
  "requirements": [
    {
      "id": "R001",
      "title": "Short label (max 10 words)",
      "description": "Self-contained requirement describing a complete feature, flow, or capability.",
      "type": "functional" | "non-functional" | "constraint",
      "priority": "must-have" | "should-have" | "nice-to-have",
      "prd_excerpts": [
        "Exact quote from PRD supporting this requirement"
      ]
    }
  ]
}`;

// ── Agent prompt loading ───────────────────────────────────────────────────────

function loadAuditSystemPrompt(): string {
  // Strip YAML frontmatter (--- ... ---) and return the body
  const match = REQUIREMENT_AUDITOR_RAW.match(/^---[\s\S]*?---\n([\s\S]*)$/);
  return match ? match[1].trim() : REQUIREMENT_AUDITOR_RAW.trim();
}


// ── Stage 1: Requirement extraction ──────────────────────────────────────────

async function extractRequirements(invoker: ClaudeInvoker, prdText: string): Promise<Requirement[]> {
  if (prdText.trim().length <= 50) return [];

  try {
    const raw = await invoker(
      REQUIREMENT_EXTRACTION_SYSTEM,
      `Extract all requirements from this PRD:\n\n## PRD Text\n${prdText}`,
      4096
    );
    const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = JSON.parse(cleaned) as { requirements: Requirement[] };
    return parsed.requirements ?? [];
  } catch (err) {
    console.warn("[local-pipeline] Requirement extraction failed, continuing:", err);
    return [];
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

// ── Stage 3: Per-requirement audit user message builder ───────────────────────

function buildRequirementUserMessage(
  req: Requirement,
  allRequirements: Requirement[],
  repoIndex: RepoIndex
): string {
  const allRequirementsJson = JSON.stringify(
    {
      requirements: allRequirements.map(({ id, title, description, type, priority }) => ({
        id, title, description, type, priority,
      })),
    },
    null,
    2
  );

  const lines: string[] = [];

  lines.push(`## Full Requirements Set (for scope awareness only)`);
  lines.push(``);
  lines.push(`The complete list of requirements being audited in this PRD is provided below.`);
  lines.push(`Use this ONLY to:`);
  lines.push(`1. Identify whether THIS requirement duplicates another in scope or behavior.`);
  lines.push(`2. Avoid flagging something as "missing" when it is already covered by a separate, dedicated requirement.`);
  lines.push(``);
  lines.push(`Audit requirements independently. Do NOT reference what other requirements say in your output — each audit block must stand alone.`);
  lines.push(``);
  lines.push("```json");
  lines.push(allRequirementsJson);
  lines.push("```");
  lines.push(``);

  lines.push(`## Requirement`);
  lines.push(`ID: ${req.id}`);
  lines.push(`Title: ${req.title}`);
  lines.push(`Type: ${req.type} | Priority: ${req.priority}`);
  lines.push(`Description: ${req.description}`);
  if (req.prd_excerpts && req.prd_excerpts.length > 0) {
    lines.push(`\n### PRD Excerpts`);
    req.prd_excerpts.forEach((excerpt, i) => lines.push(`${i + 1}. "${excerpt}"`));
  }
  lines.push(``);

  lines.push(`## Repository Index`);
  lines.push(`File count: ${repoIndex.fileCount}`);
  lines.push(`\nFile tree:\n${repoIndex.fileTree.slice(0, 3000)}`);
  if (repoIndex.routes.length > 0) lines.push(`\nExisting API routes:\n${repoIndex.routes.join("\n")}`);
  if (repoIndex.models.length > 0) lines.push(`\nModel / schema files:\n${repoIndex.models.join("\n")}`);
  if (repoIndex.services.length > 0) lines.push(`\nService / controller files:\n${repoIndex.services.join("\n")}`);
  if (repoIndex.keyFileContents) lines.push(`\nKey file contents:\n${repoIndex.keyFileContents.slice(0, 6000)}`);

  lines.push(``);
  lines.push(`Audit ONLY the requirement above and return the structured block as instructed.`);

  return lines.join("\n");
}

// ── Stage 4: Parse per-requirement audit block → Issue ────────────────────────

// Status → impact mapping
const STATUS_IMPACT: Record<string, Issue["impact"]> = {
  conflicting: "high",
  "needs-clarification": "medium",
  congruent: "low",
};

function parseRequirementAuditBlock(block: string, req: Requirement): Issue | null {
  const statusMatch = block.match(/\*\*Status\*\*:\s*([^\n]+)/i);
  const evidenceMatch = block.match(/\*\*Evidence\*\*:\s*([\s\S]*?)(?=\n\*\*[A-Z]|$)/i);
  const gapMatch = block.match(/\*\*Gap\*\*:\s*([\s\S]*?)(?=\n\*\*[A-Z]|$)/i);
  const suggestionMatch = block.match(/\*\*Suggestion\*\*:\s*([\s\S]*?)(?=\n\*\*[A-Z]|$)/i);

  const rawStatus = statusMatch?.[1]?.trim().toLowerCase() ?? "congruent";
  const impact: Issue["impact"] = STATUS_IMPACT[rawStatus] ?? "low";

  const gap = gapMatch?.[1]?.trim() ?? "";
  const suggestion = suggestionMatch?.[1]?.trim() ?? "";
  const evidence = evidenceMatch?.[1]?.trim() ?? "";

  return {
    id: req.id,
    summary: req.title,
    description: gap || `Requirement ${req.id} is ${rawStatus}.`,
    impact,
    recommendation: suggestion || "None.",
    affectedArea: "other",
    evidence: evidence || undefined,
  };
}

function parseAllAuditBlocks(auditBlocks: Array<{ raw: string; req: Requirement }>): Issue[] {
  const issues: Issue[] = [];
  for (const { raw, req } of auditBlocks) {
    const issue = parseRequirementAuditBlock(raw, req);
    if (issue) issues.push(issue);
  }
  return issues;
}

function deriveBadge(issues: Issue[]): AnalysisResult["badge"] {
  if (issues.some((i) => i.impact === "critical")) return "not-ready";
  if (issues.some((i) => i.impact === "high")) return "needs-work";
  if (issues.some((i) => i.impact === "medium")) return "mostly-ready";
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
  invoker: ClaudeInvoker,
  onProgress: (update: LocalJobProgress) => void
): Promise<AnalysisResult> {
  const systemPrompt = loadAuditSystemPrompt();

  // Stage 1: Extract structured requirements
  onProgress({ stage: 1, stageLabel: STAGE_LABELS[0] });
  const requirements = await extractRequirements(invoker, prdText);

  // Stage 2: Build repo index
  onProgress({ stage: 2, stageLabel: STAGE_LABELS[1] });
  const repoIndex = buildRepoIndex(repo);

  // Stage 3: One isolated call per requirement
  onProgress({ stage: 3, stageLabel: STAGE_LABELS[2] });
  const auditBlocks: Array<{ raw: string; req: Requirement }> = [];

  if (requirements.length === 0) {
    console.warn("[local-pipeline] No requirements extracted from PRD.");
  } else {
    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i];
      onProgress({
        stage: 3,
        stageLabel: `Auditing ${req.id} (${i + 1} of ${requirements.length})...`,
      });
      const userMessage = buildRequirementUserMessage(req, requirements, repoIndex);
      const raw = await invoker(systemPrompt, userMessage, 2048);
      auditBlocks.push({ raw, req });
    }
  }

  // Stage 4: Parse all audit blocks into issues
  onProgress({ stage: 4, stageLabel: STAGE_LABELS[3] });
  const issues = parseAllAuditBlocks(auditBlocks);
  const badge = deriveBadge(issues);

  // Try to extract a scorecard from the combined audit output (best-effort)
  const combinedOutput = auditBlocks.map((b) => b.raw).join("\n\n");
  const scorecard = scorecardFromReport(combinedOutput);

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
