import React, { useState } from "react";
import type { AnalysisMode } from "../hooks/useSettings";

interface Props {
  currentMode: AnalysisMode;
  currentApiKey: string;
  notionToken: string;
  notionWorkspace: string;
  onSave: (mode: AnalysisMode, apiKey: string) => void;
  onConnectNotion: () => void;
  onDisconnectNotion: () => void;
  onClose: () => void;
}

export function SettingsDrawer({ currentMode, currentApiKey, notionToken, notionWorkspace, onSave, onConnectNotion, onDisconnectNotion, onClose }: Props) {
  const [mode, setMode] = useState<AnalysisMode>(currentMode);
  const [apiKey, setApiKey] = useState(currentMode === "local" ? currentApiKey : "");

  const handleModeChange = (next: AnalysisMode) => {
    setMode(next);
    if (next !== "local") setApiKey("");
  };

  const saveDisabled = mode === "local" && apiKey.trim().length === 0;

  const handleSave = () => {
    onSave(mode, apiKey.trim());
    onClose();
  };

  return (
    <div className="absolute inset-0 bg-white z-10 flex flex-col overflow-hidden">
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
      <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Analysis Mode</p>

        {/* Mode options */}
        <div className="flex flex-col gap-2">
          {/* Remote */}
          <button
            onClick={() => handleModeChange("remote")}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
              mode === "remote"
                ? "bg-brand-50 border-brand-500"
                : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                mode === "remote" ? "border-brand-500" : "border-gray-300"
              }`}>
                {mode === "remote" && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
              </span>
              <span className="text-xs font-medium text-gray-800">Remote (Alucify)</span>
            </div>
            {mode === "remote" && (
              <div className="mt-1.5 ml-5 flex flex-col gap-0.5">
                <p className="text-xs text-gray-500 flex items-center gap-1"><span className="text-green-500">✓</span> No API key required</p>
                <p className="text-xs text-gray-500 flex items-center gap-1"><span className="text-green-500">✓</span> No code saved on our servers</p>
              </div>
            )}
          </button>

          {/* Local — API key */}
          <button
            onClick={() => handleModeChange("local")}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
              mode === "local"
                ? "bg-purple-50 border-purple-500"
                : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                mode === "local" ? "border-purple-500" : "border-gray-300"
              }`}>
                {mode === "local" && <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />}
              </span>
              <span className="text-xs font-medium text-gray-800">Local (API Key)</span>
            </div>
            {mode === "local" && (
              <div className="mt-2 ml-5 flex flex-col gap-2">
                <p className="text-xs text-amber-600 flex items-center gap-1"><span>⚠</span> Requires your Anthropic API key</p>
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
              </div>
            )}
          </button>

          {/* Local — Companion (Claude subscription) */}
          <button
            onClick={() => handleModeChange("local-companion")}
            className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
              mode === "local-companion"
                ? "bg-emerald-50 border-emerald-500"
                : "border-gray-200 hover:bg-gray-50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                mode === "local-companion" ? "border-emerald-500" : "border-gray-300"
              }`}>
                {mode === "local-companion" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
              </span>
              <span className="text-xs font-medium text-gray-800">Local (Claude Subscription)</span>
            </div>
            {mode === "local-companion" && (
              <div className="mt-1.5 ml-5 flex flex-col gap-0.5">
                <p className="text-xs text-gray-500 flex items-center gap-1"><span className="text-green-500">✓</span> No API key needed — uses your Claude plan</p>
                <p className="text-xs text-gray-500 flex items-center gap-1"><span className="text-green-500">✓</span> Runs entirely on your machine</p>
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><span>ℹ</span> Requires companion app installed</p>
              </div>
            )}
          </button>
        </div>

        {/* Notion Connection */}
        <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Notion</p>
          {notionToken ? (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <span className="text-xs text-green-700">Connected to {notionWorkspace || "Notion"}</span>
              <button onClick={onDisconnectNotion} className="text-xs text-gray-400 hover:text-gray-600">
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={onConnectNotion}
              className="w-full text-xs font-medium border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors"
            >
              Connect Notion
            </button>
          )}
        </div>
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
