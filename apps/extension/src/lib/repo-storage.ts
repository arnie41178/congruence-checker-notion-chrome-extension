import { openDB } from "idb";

const DB_NAME = "alucify-repo-handles";
const DB_VERSION = 1;
const STORE = "handles";

export interface RepoMeta {
  id: string;
  name: string;
  displayPath: string;
  fileCount: number;
  totalChars: number;
  lastUsedAt: string;
}

// ── IndexedDB (FileSystemDirectoryHandle storage) ──────────────────────────────

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
}

export async function saveHandle(
  repoId: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await getDB();
  await db.put(STORE, handle, repoId);
}

export async function loadHandle(
  repoId: string
): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await getDB();
  return db.get(STORE, repoId);
}

export async function deleteHandle(repoId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, repoId);
}

// ── chrome.storage.local (metadata) ───────────────────────────────────────────

const REPOS_KEY = "alucify_repos";
const BINDINGS_KEY = "alucify_prd_repo_bindings";

export async function saveRepoMeta(meta: RepoMeta): Promise<void> {
  const all = await getAllRepos();
  const idx = all.findIndex((r) => r.id === meta.id);
  if (idx >= 0) {
    all[idx] = meta;
  } else {
    all.unshift(meta);
  }
  // Keep only 5 most recently used
  const trimmed = all.sort(
    (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
  ).slice(0, 5);
  await chrome.storage.local.set({ [REPOS_KEY]: trimmed });
}

export async function getAllRepos(): Promise<RepoMeta[]> {
  const result = await chrome.storage.local.get(REPOS_KEY);
  return (result[REPOS_KEY] as RepoMeta[]) ?? [];
}

export async function getRepoMeta(repoId: string): Promise<RepoMeta | null> {
  const all = await getAllRepos();
  return all.find((r) => r.id === repoId) ?? null;
}

// ── PRD ↔ Repo bindings ────────────────────────────────────────────────────────

export async function bindRepoToPage(
  notionPageId: string,
  repoId: string
): Promise<void> {
  const result = await chrome.storage.local.get(BINDINGS_KEY);
  const bindings = (result[BINDINGS_KEY] as Record<string, string>) ?? {};
  bindings[notionPageId] = repoId;
  await chrome.storage.local.set({ [BINDINGS_KEY]: bindings });
}

export async function getBoundRepoId(
  notionPageId: string
): Promise<string | null> {
  const result = await chrome.storage.local.get(BINDINGS_KEY);
  const bindings = (result[BINDINGS_KEY] as Record<string, string>) ?? {};
  return bindings[notionPageId] ?? null;
}

export async function getLastUsedRepo(): Promise<RepoMeta | null> {
  const all = await getAllRepos();
  return all[0] ?? null;
}
