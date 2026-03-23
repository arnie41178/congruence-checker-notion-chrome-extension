# Backlog

## Rename internal schema fields from "issues" to "requirements"

Rename `issues` → `requirements` and `issueCount` → `requirementCount` across the shared data schema for consistency with the UI terminology.

Files to update:
- `packages/shared-types/src/analysis.types.ts` — `AnalysisResult` type definition
- `apps/api/src/scripts/phase3-parse.ts` — JSON output generation
- `apps/extension/src/panel/components/ResultsPanel.tsx` — reads `result.issues`, `result.issueCount`
- `apps/extension/src/lib/report-formatter.ts` — report generation
