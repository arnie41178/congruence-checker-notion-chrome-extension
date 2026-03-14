import React from "react";

interface Props {
  onClick: () => void;
  disabled?: boolean;
}

export function RunCheckButton({ onClick, disabled }: Props) {
  return (
    <div className="flex flex-col items-center gap-2 p-6">
      <div className="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center mb-2">
        <svg className="w-6 h-6 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-gray-800">Alucify</h2>
      <p className="text-sm text-gray-500 text-center mb-4">
        Check PRD alignment with your codebase
      </p>
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-6 rounded-lg transition-colors duration-150 text-sm"
      >
        Run Congruence Check
      </button>
      {disabled && (
        <p className="text-xs text-gray-400 text-center">
          Open a Notion or Google Docs page to run a check
        </p>
      )}
    </div>
  );
}
