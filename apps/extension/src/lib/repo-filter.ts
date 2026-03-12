export const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt",
  "coverage", "vendor", "__pycache__", ".venv", "venv", "env",
  "target", ".gradle", ".DS_Store", ".cache", "tmp", "temp",
]);

const EXCLUDED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so",
  ".dylib", ".bin", ".wasm", ".map",
]);

const EXCLUDED_FILENAME_PATTERNS = [
  /\.lock$/,           // package-lock.json, yarn.lock, etc.
  /\.min\.js$/,        // minified JS
];

const INCLUDED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".kt", ".swift", ".rb", ".php", ".cs", ".cpp", ".c", ".h",
  ".yaml", ".yml", ".json", ".toml", ".sql", ".graphql", ".proto",
  ".env",
]);

// Priority order for file type selection when hitting the size cap
const EXTENSION_PRIORITY: Record<string, number> = {
  ".ts": 1, ".tsx": 1, ".js": 1, ".jsx": 1,
  ".py": 1, ".go": 1, ".rs": 1, ".java": 1, ".kt": 1,
  ".rb": 1, ".php": 1, ".cs": 1, ".cpp": 1, ".c": 1,
  ".swift": 1,
  ".yaml": 2, ".yml": 2, ".toml": 2, ".json": 2,
  ".sql": 3, ".graphql": 3, ".proto": 3,
  ".h": 4,
  ".md": 5,
};

export const MAX_FILES = 300;
export const MAX_TOTAL_CHARS = 500_000;

export function isExcludedDir(name: string): boolean {
  return EXCLUDED_DIRS.has(name);
}

export function isIncludedFile(name: string): boolean {
  const lower = name.toLowerCase();

  // Special case: README.md only for .md files
  if (lower.endsWith(".md")) {
    return lower === "readme.md" || lower.startsWith("readme.");
  }

  // Check excluded extensions first
  const ext = getExtension(lower);
  if (EXCLUDED_EXTENSIONS.has(ext)) return false;

  // Check excluded patterns
  if (EXCLUDED_FILENAME_PATTERNS.some((p) => p.test(lower))) return false;

  // Must be in included set
  return INCLUDED_EXTENSIONS.has(ext);
}

export function getExtension(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export function priorityScore(path: string): number {
  const ext = getExtension(path);
  return EXTENSION_PRIORITY[ext] ?? 99;
}

export interface FilteredFile {
  path: string;
  content: string;
}

export interface FilterResult {
  files: FilteredFile[];
  totalFiles: number;
  totalChars: number;
  wasCapped: boolean;
}

export function applyCapAndSort(files: FilteredFile[]): FilterResult {
  // Sort by priority (lower = more important), then by path for stability
  const sorted = [...files].sort((a, b) => {
    const pd = priorityScore(a.path) - priorityScore(b.path);
    return pd !== 0 ? pd : a.path.localeCompare(b.path);
  });

  let charCount = 0;
  const kept: FilteredFile[] = [];
  let wasCapped = false;

  for (const file of sorted) {
    if (kept.length >= MAX_FILES || charCount + file.content.length > MAX_TOTAL_CHARS) {
      wasCapped = true;
      continue;
    }
    kept.push(file);
    charCount += file.content.length;
  }

  return {
    files: kept,
    totalFiles: kept.length,
    totalChars: charCount,
    wasCapped,
  };
}
