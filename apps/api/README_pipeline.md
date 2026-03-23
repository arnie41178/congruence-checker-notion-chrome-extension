# PRD Audit Pipeline — Phase Reference

## Overview

The pipeline audits a codebase against a PRD (Product Requirements Document) to identify gaps, ambiguities, and conflicts. It runs in 4 sequential phases, each producing versioned output files under `apps/api/.dev/`.

```
PRD + Codebase
     │
     ▼
Phase 1 — Requirement Extraction      (.dev/p1-vNNN/)
     │  requirements.json
     ▼
Phase 2 — Per-Requirement Audit       (.dev/p2-vNNN/)
     │  RXXX-audit.md  (one per requirement)
     ▼
Phase 3 — Parse Audit Results         (.dev/p3-vNNN/)
     │  analysis-result.json
     ▼
Phase 4 — Semantic Fingerprinting     (.dev/p4-vNNN/)
     │  fingerprints.json
     ▼
   Extension Panel  /  Stability Analysis
```

---

## Phase 1 — Requirement Extraction

**Goal:** Parse the PRD and extract a structured list of requirements.

**Model:** Claude Opus

**Input:**
- `.dev/prd.md` — the Product Requirements Document

**What it does:**
1. `phase1:prep` — reads the PRD, writes a system prompt + user message, and prints the Claude CLI command(s) to run
2. Claude reads the PRD and outputs a structured `requirements.json` with each requirement's `id`, `title`, `description`, `type` (functional/non-functional), and `priority` (must-have / should-have / nice-to-have)
3. `phase1:consensus` *(multi-run only)* — if `--runs N` is used, Phase 1 runs N times independently; consensus merges them by title similarity (Jaccard ≥ 0.4), keeping only requirements that appear in at least M runs and the longest description for each

**Output:**
```
.dev/p1-vNNN/
  system-prompt.md
  user-message.md
  requirements.json              ← single-run
  requirements-run1.json         ← multi-run
  requirements-run2.json
  ...
.dev/p1-requirements-latest.json ← pointer read by Phase 2
```

**Key commands:**
```bash
pnpm phase1:prep                  # single run
pnpm phase1:prep --runs 5         # 5 independent runs → consensus merge
pnpm phase1:consensus             # merge runs manually
```

---

## Phase 2 — Per-Requirement Audit

**Goal:** Audit each requirement against the actual codebase to determine if it is implemented, missing, or conflicting.

**Model:** Claude Haiku

**Input:**
- `p1-requirements-latest.json` — requirements from Phase 1
- Codebase files (repo index built by `phase2:prep`)
- GitNexus graph context (if available)

**What it does:**
1. `phase2:prep` — scans the codebase, builds a repo index (file tree + content), optionally enriches with GitNexus call graph context, writes one `RXXX-user-message.md` per requirement plus a shared `system-prompt.md`
2. `phase2:run` — spawns **one isolated Claude process per requirement** (not a batch session). Each process receives:
   - The system prompt (auditor instructions)
   - The full requirements list (for scope/duplication awareness only)
   - The specific requirement's user message (with repo index and graph context)
   - Claude writes its audit result to `RXXX-audit.md`

Each audit produces a structured markdown block with:
- **Status**: `congruent` / `needs-clarification` / `conflicting`
- **Evidence**: relevant code elements found
- **Gap**: description of what is missing or ambiguous
- **Suggestion**: recommended PRD fix
- **Diff hunks**: specific code locations

> **Why isolated sessions?** Batch processing causes context fatigue and cross-requirement anchoring — Claude starts flagging early requirements as congruent to avoid repetition. One session per requirement eliminates this.

**Output:**
```
.dev/p2-vNNN/
  system-prompt.md
  R001-user-message.md
  R001-audit.md
  R002-user-message.md
  R002-audit.md
  ...
```

**Key commands:**
```bash
pnpm phase2:prep                              # build repo index + write prompt files
pnpm phase2:prep --fresh                      # rebuild repo index from scratch
pnpm phase2:prep --repo-root /path/to/repo    # audit a different codebase
pnpm phase2:run                               # run all audits
pnpm phase2:run --req-id R004                 # re-run single requirement
pnpm phase2:audit --req-id R004               # re-run with custom prompt override
```

---

## Phase 3 — Parse Audit Results

**Goal:** Parse all `RXXX-audit.md` files into a single structured `analysis-result.json` consumed by the extension panel.

**Model:** None (deterministic parsing, no LLM)

**Input:**
- All `RXXX-audit.md` files from `.dev/p2-vNNN/`

**What it does:**
- Reads each audit markdown file and extracts status, evidence, gap, suggestion, and diff hunks using structured section parsing
- Requirements with status `congruent` are recorded but produce no suggestion card in the UI
- Requirements with `needs-clarification` or `conflicting` become flagged issues
- Computes a Readiness Score and category-level scorecard

**Output:**
```
.dev/p3-vNNN/
  analysis-result.json    ← AnalysisResult shape consumed by extension
```

**Key commands:**
```bash
pnpm phase3:parse
pnpm phase3:parse --req-version v027   # pin to specific version
```

---

## Phase 4 — Semantic Fingerprinting

**Goal:** Assign a stable semantic fingerprint to each flagged requirement so the same underlying issue maps to the same label across multiple pipeline runs — enabling cross-run stability analysis.

**Model:** Claude Haiku

**Input:**
- `p3-vNNN/analysis-result.json` — flagged issues from Phase 3

**What it does:**
- Sends all flagged issues (summary + description + suggestion) to Claude Haiku in one batch
- Claude assigns a 4-segment fingerprint to each: `<domain>.<subject>.<aspect>.<defect>`
  - e.g. `quota.rotation.trigger.missing`, `auth.token.validation.ambiguous`
- The same underlying gap should produce the same fingerprint across runs even if wording varies
- Fingerprints are matched back to requirement IDs by summary text

**Output:**
```
.dev/p4-vNNN/
  system-prompt.md
  user-message.md
  fingerprints.json    ← { version, generatedAt, fingerprints: [{ id, summary, fingerprint }] }
```

**Key commands:**
```bash
pnpm phase4:fingerprint                        # fingerprint latest version
pnpm phase4:fingerprint --req-version v026     # pin to specific version
```

---

## Configuration

### Pipeline flags

| CLI flag | Applies to | Default | Description |
|---|---|---|---|
| `--runs N` | `phase1:prep`, `pipeline` | `1` | Number of Phase 1 extraction runs for consensus merge |
| `--fresh` | `phase2:prep`, `pipeline` | off | Rebuild the repo index instead of using the cached version |
| `--repo-root` | `phase2:prep`, `pipeline` | current monorepo | Path to the codebase to audit |
| `--prd` | `pipeline` | `.dev/prd.md` | Path to the PRD file to audit against |
| `--req-id` | `phase2:run`, `phase2:audit` | *(all)* | Limit audit to a single requirement ID |

The `PIPELINE_CONSENSUS_RUNS` environment variable sets the default number of consensus runs and can be configured in `apps/api/.env`:
```
PIPELINE_CONSENSUS_RUNS=5
```

### Stability analysis flags

These flags apply only to the post-pipeline comparison scripts (`phase4:compare`, `phase4:compare-multi`) and do not affect the pipeline itself.

| CLI flag | Default | Description |
|---|---|---|
| `--threshold N` | `0.55` | Similarity threshold for fingerprint matching (0.0–1.0). Lower values match more aggressively; higher values require closer similarity. |
| `--llm` | off | Use Claude Haiku for fingerprint matching instead of token similarity |
| `--latest N` | `5` | *(multi-version only)* Number of most recent versions to compare |
| `--versions` | *(auto)* | *(multi-version only)* Explicit comma-separated version list, e.g. `v020,v021,v022` |

---

## Stability Analysis (post-pipeline)

Two comparison scripts analyse fingerprint stability across multiple pipeline runs.

### Pairwise comparison
```bash
pnpm phase4:compare --v1 v026 --v2 v028
```
Reports exact matches, fuzzy matches (combined token + summary similarity score), added, and removed issues between two versions.

### Multi-version comparison
```bash
pnpm phase4:compare-multi --latest 10
pnpm phase4:compare-multi --versions v020,v021,...,v029
pnpm phase4:compare-multi --llm        # use Claude Haiku for matching instead of token similarity
```
Clusters issues across N versions. Reports:
- **Overall stability %** — avg presence of each cluster across all versions
- **Consensus score %** — fraction of issues appearing in every version
- **Avg text similarity %** — mean semantic similarity of matched pairs

---

## Running the Full Pipeline

```bash
cd apps/api

# Full pipeline (1 extraction run)
pnpm pipeline

# Full pipeline with consensus (5 extraction runs)
pnpm pipeline --runs 5

# Audit a specific codebase + PRD
pnpm pipeline --repo-root /path/to/repo --prd .dev/prd-custom.md

# Run a single phase
pnpm pipeline --phase 1
pnpm pipeline --phase 2
pnpm pipeline --phase 3
pnpm pipeline --phase 4

# Re-run Phase 2 for a single requirement
pnpm pipeline --phase 2 --req-id R004
```

---

## Versioning Convention

Every pipeline run produces a new version number (`vNNN`) that is shared across all phases for that run:

| Folder | Contents |
|---|---|
| `.dev/p1-vNNN/` | Requirement extraction prompts + outputs |
| `.dev/p2-vNNN/` | Per-requirement audit prompts + outputs |
| `.dev/p3-vNNN/` | Parsed analysis result |
| `.dev/p4-vNNN/` | Semantic fingerprints |
| `.dev/p1-requirements-latest.json` | Pointer to most recent requirements |
| `.dev/repo-index.json` | Cached codebase index (reused across runs) |
