import React, { useEffect, useState } from "react";
import { useAnalysis } from "./hooks/useAnalysis";
import { useNotionPage } from "./hooks/useNotionPage";
import { useRepoMemory } from "./hooks/useRepoMemory";
import { RunCheckButton } from "./components/RunCheckButton";
import { RepoSelector } from "./components/RepoSelector";
import { ProgressStates } from "./components/ProgressStates";
import { ResultsPanel } from "./components/ResultsPanel";

type AppStep = "idle" | "repo_selection" | "running" | "results" | "error";

export default function App() {
  const { pageId, source } = useNotionPage();
  const { state: analysis, startAnalysis, reset: resetAnalysis } = useAnalysis();
  const { state: repo, pickAndRead, useStoredRepo, clearSelection } = useRepoMemory(pageId);
  const [step, setStep] = useState<AppStep>("idle");

  // Notify background when panel opens
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PANEL_OPENED" });
    return () => { chrome.runtime.sendMessage({ type: "PANEL_CLOSED" }); };
  }, []);

  // Sync analysis phase into step
  useEffect(() => {
    if (analysis.phase === "running") setStep("running");
    if (analysis.phase === "results") setStep("results");
    if (analysis.phase === "error") setStep("error");
  }, [analysis.phase]);

  // When repo is selected and we were in repo_selection, kick off analysis
  useEffect(() => {
    if (step === "repo_selection" && repo.selected && repo.lastResult) {
      const repoPayload = {
        name: repo.selected.name,
        files: repo.lastResult.files,
        meta: {
          totalFiles: repo.lastResult.totalFiles,
          totalChars: repo.lastResult.totalChars,
        },
      };
      chrome.runtime.sendMessage({
        type: "TRACK",
        event: "repo_selected",
        properties: {
          repoName: repo.selected.name,
          fileCount: repo.selected.fileCount,
          totalChars: repo.selected.totalChars,
          wasCapped: repo.lastResult.wasCapped,
          notionPageId: pageId,
        },
      });
      startAnalysis(pageId ?? "unknown", repoPayload);
    }
  }, [repo.selected, repo.lastResult, step]);

  const handleRun = () => {
    // If repo already selected (suggestion available), go straight to confirm then run
    setStep("repo_selection");
  };

  const handleReset = () => {
    resetAnalysis();
    clearSelection();
    setStep("idle");
  };

  const handleResultsViewed = () => {
    chrome.runtime.sendMessage({
      type: "TRACK",
      event: "analysis_results_viewed",
      properties: { jobId: analysis.jobId },
    });
  };

  const handleIssueExpand = (issueId: string) => {
    chrome.runtime.sendMessage({
      type: "TRACK",
      event: "issue_expanded",
      properties: { issueId, jobId: analysis.jobId },
    });
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <div className="w-6 h-6 bg-brand-500 rounded flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-gray-700">Alucify</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${source ? "text-green-600 bg-green-50 border-green-200" : "text-gray-400 bg-gray-50 border-gray-200"}`}>
          {source === "notion" && "Notion Page Detected"}
          {source === "google-docs" && "Google Docs Detected"}
          {!source && "Page Not Detected"}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1">
        {step === "idle" && (
          <RunCheckButton onClick={handleRun} disabled={!pageId} />
        )}

        {step === "repo_selection" && (
          <RepoSelector
            state={repo}
            onPick={pickAndRead}
            onUseStored={useStoredRepo}
            onClear={clearSelection}
          />
        )}

        {step === "running" && (
          <ProgressStates stage={analysis.stage} stageLabel={analysis.stageLabel} />
        )}

        {step === "results" && analysis.result && (
          <ResultsPanel
            result={analysis.result}
            onReset={handleReset}
            onIssueExpand={handleIssueExpand}
            onResultsViewed={handleResultsViewed}
          />
        )}

        {step === "error" && (
          <div className="p-6 flex flex-col items-center gap-4">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm text-gray-700 text-center">{analysis.error}</p>
            <button onClick={handleReset} className="text-sm text-brand-600 hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
