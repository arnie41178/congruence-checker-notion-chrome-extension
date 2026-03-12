import { useState, useEffect, useCallback } from "react";
import {
  getAllRepos,
  getBoundRepoId,
  getLastUsedRepo,
  getRepoMeta,
  saveRepoMeta,
  saveHandle,
  loadHandle,
  bindRepoToPage,
} from "../../lib/repo-storage";
import { readRepository } from "../../lib/repo-reader";
import type { RepoMeta } from "../../lib/repo-storage";
import type { FilterResult } from "../../lib/repo-filter";

export interface RepoState {
  selected: RepoMeta | null;
  suggestion: RepoMeta | null;      // bound or last-used repo
  history: RepoMeta[];
  isReading: boolean;
  readProgress: { scanned: number; found: number } | null;
  lastResult: FilterResult | null;
  wasCapped: boolean;
  error: string | null;
}

export function useRepoMemory(notionPageId: string | null) {
  const [state, setState] = useState<RepoState>({
    selected: null,
    suggestion: null,
    history: [],
    isReading: false,
    readProgress: null,
    lastResult: null,
    wasCapped: false,
    error: null,
  });

  // Load suggestion and history on mount / when page changes
  useEffect(() => {
    if (!notionPageId) return;
    loadSuggestion(notionPageId);
  }, [notionPageId]);

  async function loadSuggestion(pageId: string) {
    const history = await getAllRepos();
    const boundId = await getBoundRepoId(pageId);
    const suggestion = boundId
      ? await getRepoMeta(boundId)
      : await getLastUsedRepo();
    setState((s) => ({ ...s, history, suggestion }));
  }

  // Open native folder picker and read repo
  const pickAndRead = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "read" });
    } catch (err: unknown) {
      // User cancelled
      if (err instanceof Error && err.name === "AbortError") return;
      setState((s) => ({ ...s, error: "Could not open folder picker." }));
      return;
    }

    setState((s) => ({ ...s, isReading: true, readProgress: null }));

    try {
      const result = await readRepository(dirHandle, (progress) => {
        setState((s) => ({ ...s, readProgress: progress }));
      });

      const repoId = crypto.randomUUID();
      const meta: RepoMeta = {
        id: repoId,
        name: dirHandle.name,
        displayPath: dirHandle.name,
        fileCount: result.totalFiles,
        totalChars: result.totalChars,
        lastUsedAt: new Date().toISOString(),
      };

      await saveHandle(repoId, dirHandle);
      await saveRepoMeta(meta);
      if (notionPageId) await bindRepoToPage(notionPageId, repoId);

      const history = await getAllRepos();
      setState((s) => ({
        ...s,
        selected: meta,
        suggestion: meta,
        history,
        isReading: false,
        lastResult: result,
        wasCapped: result.wasCapped,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isReading: false,
        error: `Failed to read repository: ${String(err)}`,
      }));
    }
  }, [notionPageId]);

  // Use a previously stored repo (from history)
  const useStoredRepo = useCallback(async (repoId: string) => {
    const meta = await getRepoMeta(repoId);
    if (!meta) return;

    const dirHandle = await loadHandle(repoId);
    if (!dirHandle) {
      setState((s) => ({
        ...s,
        error: "Repository access expired. Please re-select the folder.",
      }));
      return;
    }

    // Verify we still have permission
    const permission = await dirHandle.queryPermission({ mode: "read" });
    if (permission !== "granted") {
      const req = await dirHandle.requestPermission({ mode: "read" });
      if (req !== "granted") {
        setState((s) => ({
          ...s,
          error: "Permission denied. Please re-select the folder.",
        }));
        return;
      }
    }

    setState((s) => ({ ...s, isReading: true, readProgress: null, error: null }));

    try {
      const result = await readRepository(dirHandle, (progress) => {
        setState((s) => ({ ...s, readProgress: progress }));
      });

      const updated: RepoMeta = {
        ...meta,
        fileCount: result.totalFiles,
        totalChars: result.totalChars,
        lastUsedAt: new Date().toISOString(),
      };
      await saveRepoMeta(updated);
      if (notionPageId) await bindRepoToPage(notionPageId, repoId);

      const history = await getAllRepos();
      setState((s) => ({
        ...s,
        selected: updated,
        history,
        isReading: false,
        lastResult: result,
        wasCapped: result.wasCapped,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        isReading: false,
        error: `Failed to read repository: ${String(err)}`,
      }));
    }
  }, [notionPageId]);

  const clearSelection = useCallback(() => {
    setState((s) => ({ ...s, selected: null, lastResult: null, wasCapped: false }));
  }, []);

  return { state, pickAndRead, useStoredRepo, clearSelection };
}
