import React from "react";
import type { Scorecard, CategoryScore } from "@alucify/shared-types";

interface Props {
  scorecard: Scorecard;
}

function scoreLabel(score: number): { label: string; color: string; barColor: string } {
  if (score >= 9) return { label: "Excellent", color: "bg-green-100 text-green-700 border-green-300", barColor: "bg-green-500" };
  if (score >= 7) return { label: "Good", color: "bg-teal-100 text-teal-700 border-teal-300", barColor: "bg-teal-500" };
  if (score >= 5) return { label: "Fair", color: "bg-amber-100 text-amber-700 border-amber-300", barColor: "bg-amber-500" };
  return { label: "Needs Work", color: "bg-red-100 text-red-700 border-red-300", barColor: "bg-red-500" };
}

function ScoreBar({ score, barColor }: { score: number; barColor: string }) {
  return (
    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${barColor}`}
        style={{ width: `${(score / 10) * 100}%` }}
      />
    </div>
  );
}

function CategoryCard({ title, data }: { title: string; data: CategoryScore }) {
  const { label, color, barColor } = scoreLabel(data.score);
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${color}`}>{label}</span>
          <span className="text-sm font-bold text-gray-700">{data.score}<span className="text-xs font-normal text-gray-400">/10</span></span>
        </div>
      </div>
      <ScoreBar score={data.score} barColor={barColor} />
      <p className="text-xs text-gray-500 line-clamp-3">{data.summary}</p>
      {data.suggestions.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {data.suggestions.map((s, i) => (
            <li key={i} className="text-xs text-gray-600 flex items-start gap-1.5">
              <span className="text-gray-400 shrink-0">•</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CATEGORY_TITLES: Record<keyof Scorecard["categories"], string> = {
  terminology: "Concept Terminology",
  conflicts: "Implicit Conflicts",
  duplication: "Duplicated Functionality",
  missing: "Missing Requirements",
};

export function ScorecardPanel({ scorecard }: Props) {
  const overall = scoreLabel(scorecard.overallScore);

  return (
    <div className="flex flex-col gap-4">
      {/* Overall score card */}
      <div className="border border-gray-200 rounded-lg px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-800">Overall Score</span>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${overall.color}`}>{overall.label}</span>
            <span className="text-lg font-bold text-gray-800">{scorecard.overallScore}<span className="text-sm font-normal text-gray-400">/10</span></span>
          </div>
        </div>
        <ScoreBar score={scorecard.overallScore} barColor={overall.barColor} />
        <p className="text-xs text-gray-500 line-clamp-3">{scorecard.overallSummary}</p>

        {scorecard.topPriorities.length > 0 && (
          <div className="mt-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Top Priorities</p>
            <ol className="flex flex-col gap-1">
              {scorecard.topPriorities.map((p, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Category scores */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Category Scores</p>
      {(Object.keys(CATEGORY_TITLES) as Array<keyof Scorecard["categories"]>).map((key) => (
        <CategoryCard key={key} title={CATEGORY_TITLES[key]} data={scorecard.categories[key]} />
      ))}
    </div>
  );
}
