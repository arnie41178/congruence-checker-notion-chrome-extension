import React from "react";
import type { RepoMeta } from "../../lib/repo-storage";
import type { RepoState } from "../hooks/useRepoMemory";

function formatChars(chars: number): string {
  if (chars >= 1_000_000) return `${(chars / 1_000_000).toFixed(1)}MB`;
  if (chars >= 1_000) return `${(chars / 1_000).toFixed(0)}KB`;
  return `${chars}B`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

interface Props {
  state: RepoState;
  onPick: () => void;
  onUseStored: (repoId: string) => void;
  onClear: () => void;
}

export function RepoSelector({ state, onPick, onUseStored, onClear }: Props) {
  const { selected, suggestion, history, isReading, readProgress, wasCapped, error } = state;

  // ── Reading state ──────────────────────────────────────────────────────────
  if (isReading) {
    return (
      <div className="p-6 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-brand-500 border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-sm text-gray-700">Reading repository...</span>
        </div>
        {readProgress && (
          <p className="text-xs text-gray-400 pl-8">
            {readProgress.found} files found ({readProgress.scanned} scanned)
          </p>
        )}
      </div>
    );
  }

  // ── Selected state ─────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{selected.name}</p>
              <p className="text-xs text-gray-400">
                {selected.fileCount} files · {formatChars(selected.totalChars)}
              </p>
            </div>
          </div>
          <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600 ml-2 shrink-0">
            Change
          </button>
        </div>

        {wasCapped && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Large repository detected. Analyzing 300 most relevant files.
          </div>
        )}

        <p className="text-xs text-gray-400 text-center">
          Your code stays on your machine. Only filtered source files are temporarily transmitted for analysis.
        </p>
      </div>
    );
  }

  // ── Picker state ───────────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-gray-800 mb-1">Select your repository</p>
        <p className="text-xs text-gray-400">
          Your code stays on your machine. Only filtered source files are temporarily transmitted for analysis.
        </p>
      </div>

      {/* Source type selector */}
      <div className="flex flex-col gap-2">
        {/* GitHub Repo — disabled, coming soon */}
        <div className="flex items-center gap-3 px-3 py-2.5 border border-gray-100 bg-gray-50 rounded-lg cursor-not-allowed opacity-60">
          <span className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />
          <span className="text-sm text-gray-400 flex-1">GitHub Repo</span>
          <span className="text-xs font-medium text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
            Coming Soon
          </span>
        </div>

        {/* Local Folder — selected, locked */}
        <label className="flex items-center gap-3 px-3 py-2.5 border border-blue-200 bg-blue-50 rounded-lg cursor-default">
          <span className="w-4 h-4 rounded-full border-2 border-blue-600 flex items-center justify-center shrink-0">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
          </span>
          <span className="text-sm font-medium text-gray-800">Local Folder</span>
        </label>
      </div>

      {/* Suggestion */}
      {suggestion && (
        <div className="border border-brand-100 bg-brand-50 rounded-lg p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-brand-600 font-medium mb-0.5">Previously used</p>
            <p className="text-sm font-medium text-gray-800 truncate">{suggestion.name}</p>
            <p className="text-xs text-gray-400">
              {suggestion.fileCount} files · {timeAgo(suggestion.lastUsedAt)}
            </p>
          </div>
          <button
            onClick={() => onUseStored(suggestion.id)}
            className="shrink-0 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white px-3 py-1.5 rounded-md transition-colors"
          >
            Use this
          </button>
        </div>
      )}

      <button
        onClick={onPick}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 hover:border-brand-400 hover:bg-brand-50 text-gray-600 hover:text-brand-600 rounded-lg py-4 text-sm font-medium transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        Browse folder...
      </button>

      {/* History */}
      {history.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Recent repositories</p>
          <div className="flex flex-col gap-1">
            {history.filter((r) => r.id !== suggestion?.id).map((repo) => (
              <button
                key={repo.id}
                onClick={() => onUseStored(repo.id)}
                className="flex items-center justify-between w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 truncate">{repo.name}</p>
                  <p className="text-xs text-gray-400">{timeAgo(repo.lastUsedAt)}</p>
                </div>
                <span className="text-xs text-brand-500 ml-2 shrink-0">Use</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500 text-center">{error}</p>
      )}
    </div>
  );
}
