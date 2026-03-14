import React, { useState } from "react";
import type { AnalysisMode } from "../hooks/useSettings";

interface Props {
  currentMode: AnalysisMode;
  currentApiKey: string;
  onSave: (mode: AnalysisMode, apiKey: string) => void;
  onClose: () => void;
}

export function SettingsDrawer({ currentMode, currentApiKey, onSave, onClose }: Props) {
  const [mode, setMode] = useState<AnalysisMode>(currentMode);
  const [apiKey, setApiKey] = useState(currentMode === "local" ? currentApiKey : "");

  const handleModeChange = (next: AnalysisMode) => {
    setMode(next);
    if (next === "remote") setApiKey("");
  };

  const saveDisabled = mode === "local" && apiKey.trim().length === 0;

  const handleSave = () => {
    onSave(mode, apiKey.trim());
    onClose();
  };

  return (
    <div className="absolute inset-0 bg-white z-10 flex flex-col">
      {/* Drawer header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Settings</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col gap-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Analysis Mode</p>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => handleModeChange("remote")}
            className={`flex-1 text-xs rounded-lg px-3 py-2 border font-medium transition-colors ${
              mode === "remote"
                ? "bg-brand-500 text-white border-brand-500"
                : "text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            Remote
          </button>
          <button
            onClick={() => handleModeChange("local")}
            className={`flex-1 text-xs rounded-lg px-3 py-2 border font-medium transition-colors ${
              mode === "local"
                ? "bg-purple-600 text-white border-purple-600"
                : "text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            Local
          </button>
        </div>

        {/* Mode description */}
        {mode === "remote" && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="text-green-500">✓</span> No API key required
            </p>
            <p className="text-xs text-gray-500 flex items-center gap-1.5">
              <span className="text-green-500">✓</span> No code is ever saved on our servers
            </p>
          </div>
        )}

        {mode === "local" && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <span>⚠</span> Requires your Anthropic API key
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="text-xs border border-gray-200 rounded-lg px-3 py-2 w-full focus:outline-none focus:border-purple-400 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="px-4 pb-4">
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          className={`w-full text-sm font-medium py-2 rounded-lg transition-colors ${
            saveDisabled
              ? "bg-gray-100 text-gray-300 cursor-not-allowed"
              : "bg-brand-500 text-white hover:bg-brand-600"
          }`}
        >
          Save
        </button>
      </div>
    </div>
  );
}
