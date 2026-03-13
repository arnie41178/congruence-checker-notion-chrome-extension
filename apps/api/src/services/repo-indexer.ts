import type { RepoContext, RepoFile } from "@alucify/shared-types";
import type { PrdEntities } from "../prompts/prd-extraction.prompt.js";

export interface RepoIndex {
  fileCount: number;
  fileTree: string;
  routes: string[];
  models: string[];
  services: string[];
  keyFileContents: string;
}

// Patterns for route detection across frameworks
const ROUTE_PATTERNS = [
  /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)/gi,  // Express
  /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*['"`]([^'"`]+)/gi,                  // NestJS
  /path\s*=\s*['"`]([^'"`]+)/gi,                                               // FastAPI/Flask
  /route\s*=\s*['"`]([^'"`]+)/gi,
];

// File names/patterns that suggest models/schemas
const MODEL_FILE_PATTERNS = [
  /\.(model|schema|entity|type|interface)\.(ts|js|py|go|java|rs)$/i,
  /models?\//i,
  /schemas?\//i,
  /entities?\//i,
  /types?\//i,
];

// File names that suggest services
const SERVICE_FILE_PATTERNS = [
  /\.(service|controller|handler|resolver)\.(ts|js|py|go|java|rs)$/i,
  /services?\//i,
  /controllers?\//i,
  /handlers?\//i,
];

// Key files to include in full for LLM context
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

export function buildRepoIndex(repo: RepoContext): RepoIndex {
  const { files } = repo;

  const fileTree = buildFileTree(files.map((f) => f.path));
  const routes = extractRoutes(files);
  const models = extractModelNames(files);
  const services = extractServiceNames(files);
  const keyFileContents = extractKeyFileContents(files);

  return {
    fileCount: files.length,
    fileTree,
    routes,
    models,
    services,
    keyFileContents,
  };
}

export function runHeuristicChecks(
  prdEntities: PrdEntities,
  index: RepoIndex
): string[] {
  const findings: string[] = [];
  const allText = `${index.routes.join(" ")} ${index.models.join(" ")} ${index.services.join(" ")} ${index.fileTree}`.toLowerCase();

  // Check 1: PRD API endpoints missing from repo
  for (const endpoint of prdEntities.apiEndpoints) {
    const path = endpoint.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+/i, "").toLowerCase();
    const simplified = path.replace(/[/:{}]/g, " ").trim();
    const found = index.routes.some((r) => r.toLowerCase().includes(simplified.split(" ")[0]));
    if (!found) {
      findings.push(`⚠ API endpoint "${endpoint}" mentioned in PRD but not found in any route definition`);
    }
  }

  // Check 2: PRD entities missing from repo
  for (const entity of prdEntities.entities) {
    const lower = entity.toLowerCase();
    if (!allText.includes(lower)) {
      findings.push(`⚠ Entity "${entity}" referenced in PRD but not found in any model, schema, or type file`);
    }
  }

  // Check 3: External integrations not wired
  for (const integration of prdEntities.integrations) {
    const lower = integration.toLowerCase();
    if (!allText.includes(lower)) {
      findings.push(`⚠ Integration "${integration}" mentioned in PRD but no corresponding package or file found in repo`);
    }
  }

  return findings;
}

function buildFileTree(paths: string[]): string {
  return paths.slice(0, 200).join("\n");
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

function extractModelNames(files: RepoFile[]): string[] {
  return files
    .filter((f) => MODEL_FILE_PATTERNS.some((p) => p.test(f.path)))
    .map((f) => f.path)
    .slice(0, 50);
}

function extractServiceNames(files: RepoFile[]): string[] {
  return files
    .filter((f) => SERVICE_FILE_PATTERNS.some((p) => p.test(f.path)))
    .map((f) => f.path)
    .slice(0, 50);
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
