import React from "react";

const STAGES = [
  "Extracting PRD intent...",
  "Scanning repository...",
  "Mapping dependencies...",
  "Detecting incongruences...",
];

interface Props {
  stage: number;
  stageLabel: string;
}

export function ProgressStates({ stage, stageLabel }: Props) {
  const showTeaser = stage >= 3;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        <div>
          <p className="text-sm font-medium text-gray-800">{stageLabel}</p>
          <p className="text-xs text-gray-400">Stage {stage} of 4</p>
        </div>
      </div>

      {/* Stage progress dots */}
      <div className="flex gap-2">
        {STAGES.map((label, i) => (
          <div
            key={label}
            title={label}
            className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
              i + 1 <= stage ? "bg-brand-500" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      {showTeaser && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Coming soon
          </p>
          <ul className="flex flex-col gap-2 text-sm text-gray-700">
            <li className="flex items-start gap-2">
              <span>⚡</span>
              <span>
                <strong>Coverage Analysis</strong> — see what % of your PRD has code coverage
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span>🔍</span>
              <span>
                <strong>Impact Analysis</strong> — understand blast radius of your changes
              </span>
            </li>
          </ul>
          <a
            href="https://www.alucify.ai/"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
          >
            Join Beta →
          </a>
        </div>
      )}
    </div>
  );
}
