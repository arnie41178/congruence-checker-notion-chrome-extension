import React, { useEffect, useState } from "react";
import { useAnalysis } from "./hooks/useAnalysis";
import { useNotionPage } from "./hooks/useNotionPage";
import { useRepoMemory } from "./hooks/useRepoMemory";
import { useSettings } from "./hooks/useSettings";
import { RunCheckButton } from "./components/RunCheckButton";
import { RepoSelector } from "./components/RepoSelector";
import { ProgressStates } from "./components/ProgressStates";
import { ResultsPanel } from "./components/ResultsPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { OnboardingScreen } from "./components/OnboardingScreen";
import type { AnalysisMode } from "./hooks/useSettings";

type AppStep = "onboarding" | "idle" | "repo_selection" | "running" | "results" | "error";

export default function App() {
  const { pageId, source, refresh: refreshPage } = useNotionPage();
  const { state: analysis, startAnalysis, reset: resetAnalysis } = useAnalysis();
  const { state: repo, pickAndRead, useStoredRepo, clearSelection } = useRepoMemory(pageId);
  const { state: settings, save: saveSettings } = useSettings();
  const [step, setStep] = useState<AppStep>("idle");
  const [showSettings, setShowSettings] = useState(false);

  // Notify background when panel opens
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "PANEL_OPENED" });
    return () => { chrome.runtime.sendMessage({ type: "PANEL_CLOSED" }); };
  }, []);

  // Once settings load, show onboarding if mode was never set
  useEffect(() => {
    if (settings.loaded && settings.mode === undefined) {
      setStep("onboarding");
    }
  }, [settings.loaded, settings.mode]);

  // Sync analysis phase into step
  useEffect(() => {
    if (analysis.phase === "running") setStep("running");
    if (analysis.phase === "results") setStep("results");
    if (analysis.phase === "error") setStep("error");
  }, [analysis.phase]);

  // When repo is selected and we were in repo_selection, kick off analysis
  useEffect(() => {
    if (step === "repo_selection" && repo.selected && repo.lastResult) {
      console.log("[Alucify] repo files being sent:", repo.lastResult.files.map(f => f.path));
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

  const handleOnboardingComplete = (mode: AnalysisMode, apiKey: string) => {
    saveSettings(mode, apiKey);
    setStep("idle");
  };

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
    <div className="min-h-screen bg-white flex flex-col relative">
      {/* Settings drawer (overlays everything) */}
      {showSettings && settings.mode !== undefined && (
        <SettingsDrawer
          currentMode={settings.mode}
          currentApiKey={settings.apiKey}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        {/* Logo — never shrinks */}
        <img src="/logo.png" alt="Alucify" className="w-6 h-6 shrink-0 object-contain" />
        <span className="text-sm font-semibold text-gray-700 shrink-0">Alucify</span>

        {/* Badges — take remaining space, allow page badge to truncate */}
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          <button
            onClick={refreshPage}
            className={`text-xs px-2 py-0.5 rounded-full border truncate text-left ${source ? "text-green-600 bg-green-50 border-green-200 hover:bg-green-100" : "text-gray-400 bg-gray-50 border-gray-200 hover:bg-gray-100"}`}
            title="Re-detect page"
          >
            {source === "notion" && "Notion Page Detected"}
            {source === "google-docs" && "Google Docs Detected"}
            {!source && "Page Not Detected"}
          </button>

          {/* Mode badge — always fully visible */}
          {settings.mode === "local" && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border text-purple-600 bg-purple-50 border-purple-200">
              Local
            </span>
          )}
          {settings.mode === "remote" && (
            <span className="shrink-0 text-xs px-2 py-0.5 rounded-full border text-gray-500 bg-gray-50 border-gray-200">
              Remote
            </span>
          )}
        </div>

        {/* Gear — never shrinks, always visible */}
        <button
          onClick={() => setShowSettings(true)}
          className="shrink-0 text-gray-500 hover:text-gray-800 p-1"
          aria-label="Open settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1">
        {step === "onboarding" && (
          <OnboardingScreen onComplete={handleOnboardingComplete} />
        )}

        {step === "idle" && (
          <RunCheckButton onClick={handleRun} disabled={!source} />
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
