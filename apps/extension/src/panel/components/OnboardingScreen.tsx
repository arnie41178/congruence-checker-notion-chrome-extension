import React, { useState } from "react";
import type { AnalysisMode } from "../hooks/useSettings";

interface Props {
  onComplete: (mode: AnalysisMode, apiKey: string) => void;
}

export function OnboardingScreen({ onComplete }: Props) {
  const [mode, setMode] = useState<AnalysisMode>("remote");
  const [apiKey, setApiKey] = useState("");

  const canProceed = mode === "remote" || mode === "local-companion" || apiKey.trim().length > 0;

  const handleGetStarted = () => {
    onComplete(mode, apiKey.trim());
  };

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* Welcome heading */}
      <div className="flex flex-col gap-1 pt-2">
        <p className="text-base font-semibold text-gray-800">Welcome to Alucify</p>
        <p className="text-xs text-gray-500">How would you like to run your analysis?</p>
      </div>

      {/* Remote option */}
      <button
        onClick={() => { setMode("remote"); setApiKey(""); }}
        className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
          mode === "remote"
            ? "border-brand-500 bg-brand-50"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            mode === "remote" ? "border-brand-500" : "border-gray-300"
          }`}>
            {mode === "remote" && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
          </span>
          <span className="text-sm font-medium text-gray-800">Remote (Alucify)</span>
        </div>
        <div className="ml-5 flex flex-col gap-0.5">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-green-500">✓</span> No API key required
          </p>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-green-500">✓</span> No code is ever saved on our servers
          </p>
        </div>
      </button>

      {/* Local — Claude subscription via companion */}
      <button
        onClick={() => { setMode("local-companion"); setApiKey(""); }}
        className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
          mode === "local-companion"
            ? "border-emerald-500 bg-emerald-50"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            mode === "local-companion" ? "border-emerald-500" : "border-gray-300"
          }`}>
            {mode === "local-companion" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          </span>
          <span className="text-sm font-medium text-gray-800">Local (Claude Subscription)</span>
        </div>
        <div className="ml-5 flex flex-col gap-0.5">
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-green-500">✓</span> No API key — uses your Claude plan
          </p>
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <span className="text-green-500">✓</span> Runs entirely on your machine
          </p>
          <p className="text-xs text-gray-400 flex items-center gap-1">
            <span>ℹ</span> Requires companion app installed
          </p>
        </div>
      </button>

      {/* Local — API key */}
      <button
        onClick={() => setMode("local")}
        className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-colors ${
          mode === "local"
            ? "border-purple-500 bg-purple-50"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            mode === "local" ? "border-purple-500" : "border-gray-300"
          }`}>
            {mode === "local" && <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
          </span>
          <span className="text-sm font-medium text-gray-800">Local (API Key)</span>
        </div>
        <div className="ml-5">
          <p className="text-xs text-amber-600 flex items-center gap-1 mb-2">
            <span>⚠</span> Requires your Anthropic API key
          </p>
          {mode === "local" && (
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              placeholder="sk-ant-..."
              className="text-xs border border-gray-200 rounded-lg px-3 py-2 w-full focus:outline-none focus:border-purple-400 font-mono bg-white"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </div>
      </button>

      {/* Get Started button */}
      <button
        onClick={handleGetStarted}
        disabled={!canProceed}
        className={`w-full text-sm font-medium py-2.5 rounded-lg transition-colors ${
          canProceed
            ? "bg-brand-500 text-white hover:bg-brand-600"
            : "bg-gray-100 text-gray-300 cursor-not-allowed"
        }`}
      >
        Get Started
      </button>
    </div>
  );
}
