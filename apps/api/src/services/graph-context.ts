import { writeFile, mkdir, rm } from "fs/promises";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { exec } from "child_process";
import { promisify } from "util";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations for @ladybugdb/core
import lbug from "@ladybugdb/core";
import type { RepoContext } from "@alucify/shared-types";

const execAsync = promisify(exec);

// ── Types ─────────────────────────────────────────────────────────────────────

interface GraphFunction {
  "n.id": string;
  "n.name": string;
  "n.filePath": string;
  "n.startLine": number;
  "n.endLine": number;
  "n.description": string | null;
  "n.content": string | null;
}

interface GraphInterface {
  "n.id": string;
  "n.name": string;
  "n.filePath": string;
  "n.startLine": number;
  "n.description": string | null;
}

interface GraphRelationship {
  "a.name": string;
  "r.type": string;
  "b.name": string;
  "r.confidence": number;
  "r.reason": string | null;
}

interface GraphProcess {
  "p.id": string;
  "p.label": string;
  "p.heuristicLabel": string | null;
  "p.processType": string;
  "p.stepCount": number;
  "p.entryPointId": string | null;
}

interface GraphExport {
  functions: GraphFunction[];
  classes: GraphFunction[];
  methods: GraphFunction[];
  interfaces: GraphInterface[];
  structs: unknown[];
  enums: unknown[];
  traits: unknown[];
  relationships: GraphRelationship[];
  processes: GraphProcess[];
  communities: unknown[];
  files: { "n.id": string; "n.name": string; "n.filePath": string }[];
  folders: { "n.id": string; "n.name": string; "n.filePath": string }[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Write repo files to a temp directory, run `gitnexus analyze` to build the
 * ladybug graph DB, query it in-memory, build a compact summary string, then
 * clean up. Returns null on any failure (graceful degradation).
 *
 * Enabled via USE_GRAPH_CONTEXT=true in apps/api/.env.
 */
export async function buildGraphContextFromRepo(
  repo: RepoContext
): Promise<string | null> {
  if (process.env.USE_GRAPH_CONTEXT !== "true") return null;

  const tempDir = join(tmpdir(), `alucify-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  try {
    // 1. Write repo files to temp directory
    console.log(`[graph-context] Writing ${repo.files.length} files to ${tempDir}`);
    for (const file of repo.files) {
      const filePath = join(tempDir, file.path);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, file.content, "utf-8");
    }

    // 2. Initialize a git repo (gitnexus requires one) and run analyze
    console.log("[graph-context] Running gitnexus analyze...");
    await execAsync("git init && git add -A && git commit -m init --allow-empty", { cwd: tempDir, timeout: 30_000 });
    const gitnexusBin = join(process.cwd(), "node_modules/.bin/gitnexus");
    await execAsync(`${gitnexusBin} analyze`, { cwd: tempDir, timeout: 120_000 });

    // 3. Connect to the generated ladybug DB
    const dbPath = join(tempDir, ".gitnexus", "lbug");
    const db = new lbug.Database(dbPath);
    const conn = new lbug.Connection(db);

    try {
      // 4. Query graph data in-memory
      const graph = await queryGraphData(conn);
      const summary = buildGraphSummary(graph);
      console.log(`[graph-context] Built graph context — ${summary.length} chars`);
      return summary;
    } finally {
      await conn.close();
      await db.close();
    }
  } catch (err) {
    console.warn("[graph-context] Failed to build graph context:", (err as Error).message);
    return null;
  } finally {
    // 5. Clean up temp directory
    await rm(tempDir, { recursive: true, force: true });
  }
}

// ── Ladybug DB queries ────────────────────────────────────────────────────────

async function queryGraphData(conn: { query: (cypher: string) => Promise<unknown> }): Promise<GraphExport> {
  const query = async (cypher: string) => {
    const result = await conn.query(cypher);
    const r = Array.isArray(result) ? result[0] : result;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (r as any).getAll();
  };

  const [
    functions, classes, methods, relationships,
    processes, communities, files, folders,
    interfaces, structs, enums, traits,
  ] = await Promise.all([
    query("MATCH (n:Function) RETURN n.id, n.name, n.filePath, n.startLine, n.endLine, n.description, n.content LIMIT 2000"),
    query("MATCH (n:Class) RETURN n.id, n.name, n.filePath, n.startLine, n.endLine, n.description, n.content LIMIT 500"),
    query("MATCH (n:Method) RETURN n.id, n.name, n.filePath, n.startLine, n.endLine, n.description, n.content LIMIT 2000"),
    query("MATCH (a)-[r:CodeRelation]->(b) RETURN a.name, r.type, b.name, r.confidence, r.reason LIMIT 5000"),
    query("MATCH (p:Process) RETURN p.id, p.label, p.heuristicLabel, p.processType, p.stepCount, p.entryPointId LIMIT 500"),
    query("MATCH (c:Community) RETURN c.id, c.label, c.heuristicLabel, c.keywords, c.description, c.symbolCount LIMIT 200"),
    query("MATCH (n:File) RETURN n.id, n.name, n.filePath LIMIT 2000"),
    query("MATCH (n:Folder) RETURN n.id, n.name, n.filePath LIMIT 500"),
    query("MATCH (n:Interface) RETURN n.id, n.name, n.filePath, n.startLine, n.description LIMIT 500"),
    query("MATCH (n:`Struct`) RETURN n.id, n.name, n.filePath, n.startLine, n.description LIMIT 500"),
    query("MATCH (n:`Enum`) RETURN n.id, n.name, n.filePath, n.startLine, n.description LIMIT 500"),
    query("MATCH (n:`Trait`) RETURN n.id, n.name, n.filePath, n.startLine, n.description LIMIT 500"),
  ]);

  return {
    functions: functions as GraphFunction[],
    classes: classes as GraphFunction[],
    methods: methods as GraphFunction[],
    interfaces: interfaces as GraphInterface[],
    structs: structs as unknown[],
    enums: enums as unknown[],
    traits: traits as unknown[],
    relationships: relationships as GraphRelationship[],
    processes: processes as GraphProcess[],
    communities: communities as unknown[],
    files: files as { "n.id": string; "n.name": string; "n.filePath": string }[],
    folders: folders as { "n.id": string; "n.name": string; "n.filePath": string }[],
  };
}

// ── Summary builder ───────────────────────────────────────────────────────────

function buildGraphSummary(graph: GraphExport): string {
  const sections: string[] = [];

  // 1. Execution flows — named architectural workflows, sorted by depth
  if (graph.processes.length > 0) {
    const lines = graph.processes
      .sort((a, b) => b["p.stepCount"] - a["p.stepCount"])
      .map((p) => `  ${p["p.label"]} [${p["p.processType"]}, ${p["p.stepCount"]} steps]`);
    sections.push(`Execution Flows (${graph.processes.length}):\n${lines.join("\n")}`);
  }

  // 2. Type contracts — interfaces grouped by file
  if (graph.interfaces.length > 0) {
    const byFile = new Map<string, string[]>();
    for (const iface of graph.interfaces) {
      const file = iface["n.filePath"];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file)!.push(iface["n.name"]);
    }
    const lines = Array.from(byFile.entries()).map(
      ([file, names]) => `  [${file}]: ${names.join(", ")}`
    );
    sections.push(`Type Contracts (${graph.interfaces.length} interfaces):\n${lines.join("\n")}`);
  }

  // 3. Call graph — high-confidence CALLS edges
  const callEdges = graph.relationships
    .filter((r) => r["r.type"] === "CALLS" && r["r.confidence"] >= 0.9)
    .map((r) => `  ${r["a.name"]} → ${r["b.name"]}`);
  if (callEdges.length > 0) {
    sections.push(`Call Graph (${callEdges.length} edges):\n${callEdges.slice(0, 60).join("\n")}`);
  }

  // 4. Module import dependencies
  const importEdges = graph.relationships
    .filter((r) => r["r.type"] === "IMPORTS")
    .map((r) => `  ${r["a.name"]} → ${r["b.name"]}`);
  if (importEdges.length > 0) {
    sections.push(`Import Dependencies (${importEdges.length} edges):\n${importEdges.join("\n")}`);
  }

  // 5. Function inventory grouped by module (first 4 path segments)
  const allFunctions = [...graph.functions, ...graph.methods];
  const byModule = new Map<string, string[]>();
  for (const fn of allFunctions) {
    const key = fn["n.filePath"].split("/").slice(0, 4).join("/");
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key)!.push(fn["n.name"]);
  }
  const moduleLines = Array.from(byModule.entries()).map(
    ([mod, fns]) => `  [${mod}]: ${fns.join(", ")}`
  );
  sections.push(`Function Inventory (${allFunctions.length} symbols):\n${moduleLines.join("\n")}`);

  return sections.join("\n\n");
}
