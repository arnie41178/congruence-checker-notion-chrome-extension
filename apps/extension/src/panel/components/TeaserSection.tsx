import React from "react";

export function TeaserSection() {
  return (
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
        href="https://alucify.com/beta"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
      >
        Join Beta →
      </a>
    </div>
  );
}
