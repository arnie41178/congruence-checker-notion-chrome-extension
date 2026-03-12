# Alucify Spec-AI Readiness Checker for Notion
## Phase-Wise Implementation Plan

**Version:** 1.0 | **Date:** March 11, 2026 | **Status:** Founding Engineering Draft

---

## Table of Contents

1. Executive Summary
2. Recommended MVP Architecture
3. Major System Components
4. Tech Stack Recommendation
5. Data Model Overview
6. Identity & Auth Model
7. Telemetry Architecture
8. Safeguard Design
9. Architecture Decision Records (ADRs)
10. Phase 0 — Product Skeleton
11. Phase 1 — Local Repository Support
12. Phase 2 — Real Congruence Analysis
13. Phase 3 — Hardening
14. Phase 4 — GitHub Integration
15. Repository Structure
16. API Endpoints
17. Prompting Strategy
18. Risks & Mitigations
19. Recommended Build Order

---

## 1. Executive Summary

**What we are building:** A Chrome browser extension that embeds a "Run Congruence Check" trigger inside Notion. When invoked, it extracts the current PRD page, reads a locally selected repository, and runs an LLM-assisted analysis to surface conflicts between the PM's spec and the codebase reality.

**Why it matters:** AI coding agents like Claude Code implement what they are told. When a PRD contains assumptions that conflict with the actual codebase — missing APIs, undefined entities, broken workflow states — the agent produces broken implementations. This tool catches those gaps before the agent runs.

**MVP Strategy:** Fastest credible path to a demo-quality product. We defer GitHub integration, user accounts, and semantic code graphs entirely to later phases. Phase 0 through Phase 2 deliver a working, demo-ready product using only a Chrome extension + lightweight backend + local folder access.

**Key architectural bets:**
- Browser extension is the fastest Notion integration path (no Notion App approval, no OAuth registration)
- Local folder picker bypasses all GitHub permission friction in early phases
- Full-codebase ingestion (with filtering) is acceptable for MVP; semantic extraction comes later
- Anonymous extension client ID defers user account complexity to Phase 3+
- PostHog for telemetry: open source, self-hostable, free tier, excellent funnel analytics

---

## 2. Recommended MVP Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Chrome Extension                        │  │
│  │                                                           │  │
│  │  ┌─────────────────┐    ┌──────────────────────────────┐ │  │
│  │  │  Content Script  │    │        Side Panel            │ │  │
│  │  │                 │    │                              │ │  │
│  │  │ • Detects Notion│    │ • Run Congruence Check btn   │ │  │
│  │  │   PRD pages     │    │ • Progress states UI         │ │  │
│  │  │ • Extracts PRD  │    │ • Results display            │ │  │
│  │  │   text          │    │ • Repo selector              │ │  │
│  │  │ • Injects button│    │ • Issue cards                │ │  │
│  │  └────────┬────────┘    └──────────────┬───────────────┘ │  │
│  │           │                            │                  │  │
│  │  ┌────────▼────────────────────────────▼───────────────┐ │  │
│  │  │              Background Service Worker               │ │  │
│  │  │                                                      │ │  │
│  │  │  • Repo file reading (File System Access API)        │ │  │
│  │  │  • Repo filtering & size capping                     │ │  │
│  │  │  • API communication                                 │ │  │
│  │  │  • Extension state (chrome.storage.local)            │ │  │
│  │  │  • Client ID management                              │ │  │
│  │  │  • Telemetry dispatch                                │ │  │
│  │  └──────────────────────────┬───────────────────────────┘ │  │
│  └─────────────────────────────│───────────────────────────┘  │
│                                │                               │
│         USER'S LOCAL DISK      │                               │
│  ┌─────────────────┐           │                               │
│  │  Repository     │           │                               │
│  │  /my-app        │◄──────────┘ (File System Access API)     │
│  │    src/         │                                           │
│  │    package.json │                                           │
│  └─────────────────┘                                           │
└────────────────────────────────┬────────────────────────────────┘
                                 │ HTTPS
                    ┌────────────▼────────────┐
                    │      Backend API         │
                    │    (Node.js / Fastify)   │
                    │                         │
                    │  POST /analysis/run      │
                    │  GET  /analysis/:id      │
                    │  POST /telemetry/events  │
                    │                         │
                    │  ┌───────────────────┐  │
                    │  │  Analysis Engine  │  │
                    │  │  • PRD parsing    │  │
                    │  │  • Repo context   │  │
                    │  │  • LLM prompting  │  │
                    │  │  • Result format  │  │
                    │  └────────┬──────────┘  │
                    │           │              │
                    │  ┌────────▼──────────┐  │
                    │  │    Redis           │  │
                    │  │  (job state)       │  │
                    │  └───────────────────┘  │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Claude API (Anthropic) │
                    └─────────────────────────┘
                    ┌────────────▼────────────┐
                    │   PostHog (Telemetry)    │
                    └─────────────────────────┘
```

---

## 3. Major System Components

| Component | Role | Phase Introduced |
|---|---|---|
| **Chrome Extension — Content Script** | Detects Notion PRD pages, extracts page text, injects trigger button | Phase 0 |
| **Chrome Extension — Side Panel** | Primary UI surface: button, progress, results, repo selection | Phase 0 |
| **Chrome Extension — Background Service Worker** | Orchestrates file reading, API calls, state, telemetry | Phase 0 |
| **Backend API** | Receives analysis requests, orchestrates LLM calls, returns results | Phase 0 (mocked) → Phase 2 (real) |
| **Analysis Engine** | PRD parsing + repo context ingestion + LLM congruence detection | Phase 2 |
| **Redis** | Ephemeral job state, polling support | Phase 2 |
| **PostHog** | Telemetry ingestion and dashboards | Phase 0 |
| **File System Access API** | Browser-native repo folder reading | Phase 1 |
| **GitHub App** | Remote repo access without per-user OAuth | Phase 4 |

---

## 4. Tech Stack Recommendation

### Browser Extension

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Type safety, better IDE support for team |
| Build tool | Vite + CRXJS | Fast HMR, native Chrome Extension Manifest V3 support |
| UI framework | React + Tailwind CSS | Fast iteration, component reuse, good ecosystem |
| Storage | `chrome.storage.local` | Persistent across sessions, no server needed |
| File access | File System Access API (`showDirectoryPicker`) | Browser-native, no permissions needed beyond user selection |
| Manifest version | MV3 | Required for new Chrome extensions; side panel API available |

> **Recommendation:** Use Chrome Side Panel API (not an injected iframe or popup). Side panel persists across Notion page navigation and provides a native, high-quality UI surface without DOM injection fragility.

### Backend

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript / Node.js | Shared types with extension, fast iteration |
| Framework | Fastify | Lightweight, fast, good plugin ecosystem, schema validation |
| LLM | Claude claude-sonnet-4-6 via Anthropic SDK | Highest quality reasoning for code/spec analysis |
| Job state | Redis (Upstash serverless) | Simple, cheap, no infra management for MVP |
| Hosting | Railway or Render | One-click deploy, free tier, easy env management |
| Database | None in MVP (Redis only) | Deferred — no persistent user data in early phases |

> **MVP Shortcut:** No database in Phase 0–2. All state lives in Redis (ephemeral job tracking) and `chrome.storage.local` (client-side repo memory).

### Telemetry

| Layer | Choice |
|---|---|
| Platform | PostHog (Cloud, free tier) |
| Extension SDK | `posthog-js` |
| Backend SDK | `posthog-node` |

> **Recommendation: PostHog.** Rationale: open source (self-hostable later), generous free tier (1M events/month), built-in funnel analysis, session recording available, no vendor lock-in. Amplitude and Mixpanel are strong alternatives but are proprietary and cost more at scale.

---

## 5. Data Model Overview

All state in Phase 0–3 is either ephemeral (Redis) or client-local (`chrome.storage.local`). There is no persistent database until Phase 4+.

### `chrome.storage.local` Schema (Extension-Side)

```json
{
  "clientId": "uuid-v4",
  "lastUsedRepo": {
    "name": "my-app",
    "path": "/Users/arnab/repos/my-app",
    "lastUsedAt": "2026-03-11T..."
  },
  "repoHistory": [
    {
      "id": "uuid",
      "name": "my-app",
      "lastUsedAt": "...",
      "fileHandle": "stored in IndexedDB — keyed by id"
    }
  ],
  "prdRepoBindings": {
    "<notion-page-id>": "<repo-id>"
  },
  "analysisCache": {
    "<notion-page-id>": {
      "jobId": "uuid",
      "status": "completed",
      "completedAt": "...",
      "results": {}
    }
  }
}
```

> **Note:** `FileSystemDirectoryHandle` objects cannot be stored in `chrome.storage`. They must be persisted via IndexedDB using the `idb` library. Store the handle in IndexedDB keyed by repo ID; store metadata (name, lastUsedAt) in `chrome.storage.local`.

### Redis Schema (Backend-Side)

```
Key:   job:<jobId>
TTL:   1 hour
Value: {
  "jobId": "uuid",
  "status": "pending" | "running" | "completed" | "failed",
  "createdAt": "...",
  "completedAt": "...",
  "clientId": "uuid",
  "notionPageId": "string",
  "repoName": "string",
  "result": { ... } | null,
  "error": "string" | null
}
```

### Analysis Result Schema

```json
{
  "jobId": "uuid",
  "status": "completed",
  "meta": {
    "notionPageId": "string",
    "repoName": "string",
    "prdWordCount": 420,
    "repoFilesAnalyzed": 38,
    "analysisVersion": "1.0",
    "durationMs": 12400
  },
  "issues": [
    {
      "id": "uuid",
      "type": "missing_api | missing_entity | state_conflict | workflow_conflict | ambiguous_reference | scope_gap",
      "severity": "critical | high | medium | low",
      "summary": "PM-friendly title",
      "description": "Plain English explanation",
      "impact": "Risk if unresolved",
      "recommendation": "Actionable PRD edit guidance",
      "prdContext": "Relevant PRD excerpt (truncated)",
      "codeContext": "Relevant file/function reference — no raw code"
    }
  ],
  "overallReadiness": "ready | needs_work | high_risk"
}
```

---

## 6. Identity & Auth Model

### Phase 0–3: Anonymous Client ID

No user accounts. No sign-in. No GitHub OAuth.

```
On extension install:
  → Generate UUID v4
  → Store as clientId in chrome.storage.local
  → Include in every API request header: X-Client-ID: <uuid>
  → Include in every telemetry event as distinct_id
```

This anonymous ID:
- Enables per-client rate limiting on the backend
- Enables funnel analysis in PostHog (tracks the same user across sessions without sign-in)
- Never contains PII
- Is not shared with GitHub or any third party

> **Assumption:** For Phase 0–3, clientId is stable per browser profile. If user reinstalls extension, a new ID is generated. This is acceptable for MVP.

> **Defer to Later:** User accounts, workspace-level identity, and team-shared analysis history are all deferred to Phase 4+.

### Phase 4: GitHub App Installation

When GitHub integration is introduced, we use a **GitHub App** (not per-user OAuth). This means:

- The organization or user installs the GitHub App once
- The App has repository-level read permissions
- No per-user OAuth tokens are issued or stored
- The extension authenticates using installation tokens issued by the App

> **Why GitHub App over OAuth:** GitHub Apps are first-class integrations with fine-grained permissions. OAuth tokens require user-level authorization on every new repo access. GitHub Apps are better suited for tooling that operates on behalf of a team, not an individual user session.

---

## 7. Telemetry Architecture

```
┌──────────────────────────────────────────────────────┐
│                 Chrome Extension                      │
│                                                       │
│  telemetry.ts (thin wrapper)                         │
│    posthog.capture(event, properties)                │
│                                                       │
│  Events batched and sent directly to PostHog         │
│  (or proxied through backend in Phase 3+)            │
└───────────────────────┬──────────────────────────────┘
                        │
            ┌───────────▼────────────┐
            │   PostHog Cloud        │
            │   (or self-hosted)     │
            │                        │
            │  Funnels               │
            │  Retention             │
            │  Dashboards            │
            │  Session Replay        │
            └────────────────────────┘
┌──────────────────────────────────────────────────────┐
│                  Backend API                          │
│                                                       │
│  posthog-node SDK                                    │
│  Captures server-side events:                        │
│    analysis_started, analysis_completed,             │
│    analysis_failed                                   │
│  Uses same clientId as distinct_id                   │
└───────────────────────┬──────────────────────────────┘
                        │
            ┌───────────▼────────────┐
            │   PostHog Cloud        │
            └────────────────────────┘
```

> **Note — Proxy vs Direct:** For Phase 0–2, send directly from the extension to PostHog. In Phase 3+, proxy telemetry through the backend to avoid AdBlockers suppressing PostHog's CDN domain and to enable server-side enrichment.

### Telemetry Principles

1. **Every event includes:** `clientId`, `extensionVersion`, `browser`, `platform`, `timestamp`
2. **Analysis events include:** `notionPageId` (hashed), `repoName`, `analysisVersion`
3. **Never include:** full PRD text, source code, file contents, OAuth tokens, secrets
4. **`notionPageId` is hashed** (SHA-256, truncated) before transmission to avoid identifying specific customer PRDs

### Telemetry Event Reference

#### Extension Lifecycle Events

| Event | When Fired | Key Properties |
|---|---|---|
| `extension_installed` | On install (`chrome.runtime.onInstalled`) | `reason: "install"`, `extensionVersion` |
| `extension_reinstalled` | On install with `reason: "update"` | `previousVersion`, `extensionVersion` |
| `extension_first_opened` | First time side panel opens (flag in storage) | `extensionVersion` |
| `extension_enabled` | `chrome.management.onEnabled` | — |
| `extension_disabled` | `chrome.management.onDisabled` | — |
| `extension_popup_opened` | Popup opens | — |
| `extension_panel_opened` | Side panel opens | `notionPageDetected: bool` |
| `extension_panel_closed` | Side panel closes | — |
| `extension_notion_page_detected` | Content script detects a Notion page | `hasH1: bool`, `wordCount: number` |

> **Note:** `extension_landing_page_viewed`, `extension_store_page_viewed`, and `extension_install_clicked` require a marketing landing page and Chrome Web Store page. Instrument these via the landing page analytics (PostHog snippet injected into the marketing page). These cannot be captured by the extension itself.

#### Product Workflow Events

| Event | When Fired | Key Properties |
|---|---|---|
| `prd_page_detected` | Content script identifies page as PRD-like | `wordCount`, `hasHeaders`, `notionPageIdHash` |
| `run_congruence_check_clicked` | User clicks the check button | `notionPageIdHash`, `repoSelected: bool` |
| `repo_selected` | User picks a folder | `repoName`, `selectionMethod: "new"|"remembered"` |
| `analysis_started` | Backend receives and begins job | `jobId`, `repoName`, `repoFileCount`, `prdWordCount` |
| `analysis_completed` | Job finishes successfully | `jobId`, `durationMs`, `issuesFound`, `overallReadiness` |
| `analysis_failed` | Job fails | `jobId`, `errorType`, `durationMs` |
| `analysis_results_viewed` | Results panel rendered | `jobId`, `issuesFound`, `overallReadiness` |
| `issue_expanded` | User opens an issue card | `jobId`, `issueId`, `issueType`, `severity` |
| `issue_resolve_clicked` | User clicks "Resolve" (Phase 3+) | `jobId`, `issueId`, `issueType` |

---

## 8. Safeguard Design

Per the product spec, safeguards are limited to two mechanisms only:

### 1. Extension-Side: Accidental Repeat Trigger Prevention

The extension must prevent users from accidentally triggering multiple concurrent analyses.

**Design:**
```
State machine in chrome.storage.local:
  analysisState: "idle" | "running" | "completed"

Rules:
  - "Run Congruence Check" button disabled when state = "running"
  - Button shows spinner + "Analysis running..." when state = "running"
  - State reset to "idle" only when analysis completes, fails, or user explicitly resets
  - If panel is closed and reopened during analysis, state is restored from storage
```

This is UI-level protection only. It prevents the common case of double-clicking or impatience re-triggering.

### 2. Backend-Side: Usage Enforcement via Client ID

The backend enforces per-client usage rules using the anonymous `clientId` sent in `X-Client-ID`.

**Design:**
```
On each POST /analysis/run:
  1. Read X-Client-ID header
  2. Check Redis key: usage:<clientId>:<date>
  3. If count >= DAILY_LIMIT → return 429 with friendly message
  4. Increment counter (INCR with TTL = end of day)

Fallback:
  If X-Client-ID is absent or malformed:
    Use IP address as enforcement key
    Apply stricter limit to IP-based requests
```

**Redis keys:**
```
usage:<clientId>:<YYYY-MM-DD>   TTL: 86400s
usage:ip:<ip-hash>:<YYYY-MM-DD> TTL: 86400s
```

> **Note:** IP address is a secondary signal only, used when clientId is missing. IP is hashed before storage (SHA-256) and never logged in plaintext.

> **Assumption:** Daily limits are configured via environment variable `MAX_ANALYSES_PER_CLIENT_PER_DAY`. Default MVP value: 10. This is generous enough not to frustrate real users but stops abuse.

---

## 9. Architecture Decision Records (ADRs)

### ADR-001: Notion Integration — Browser Extension vs Notion API

| | Browser Extension | Notion API Integration |
|---|---|---|
| **Setup time** | Days | Weeks (approval, OAuth registration) |
| **User friction** | Install extension | Authorize Notion integration per workspace |
| **PRD access** | Direct DOM read, always available | Requires page sharing, workspace admin |
| **Notion page changes** | No dependency on Notion's API versioning | Breaks on API changes |
| **Enterprise blocks** | Possible (managed Chrome policies) | Possible (workspace admin approval) |
| **Demo quality** | Excellent — feels embedded | Good — separate app |

> **Recommendation: Browser Extension.** Fastest path. Direct page access. No Notion approval process. Revisit Notion API in Phase 4+ for enterprise accounts that block extensions.

---

### ADR-002: Analysis Execution Model — Sync vs Async vs Streamed

| | Synchronous | Async + Polling | Streamed (SSE/WebSocket) |
|---|---|---|---|
| **Implementation effort** | Low | Medium | High |
| **UX quality** | Poor (UI blocks) | Good (progress states) | Best (live updates) |
| **LLM latency** | 10–30s blocks UI | 10–30s with progress feedback | Progressive display |
| **Reliability** | Fragile (timeout risks) | Robust (retry-safe) | Complex error handling |

> **Recommendation: Async + Polling.** Extension submits job → backend returns `jobId` → extension polls `GET /analysis/:jobId` every 2 seconds → backend returns current status and progress label → when complete, full results returned. This gives the "Extracting PRD intent... Scanning repository..." progress UI without streaming complexity.

> **MVP Shortcut:** Progress labels are returned from the backend as part of the job status response. They are derived from real pipeline stage transitions, not fake timers.

---

### ADR-003: Repo Analysis Depth — Shallow vs Full vs Semantic Graph

| | Shallow Scan | Full Ingestion (filtered) | Semantic Graph |
|---|---|---|---|
| **Implementation effort** | Low | Medium | Very High |
| **Analysis quality** | Low | Good for MVP | Excellent |
| **Token cost per run** | Low | Medium-High | Low (after extraction) |
| **Build time** | Days | Days-Week | Weeks-Months |

> **Recommendation: Full filtered ingestion for MVP (Phase 2).** Filter out junk directories and binary files. Cap at a configurable file count and total character limit. Pass filtered content as context to LLM. This is a temporary approach with explicit architecture boundaries that allow replacement with semantic extraction in Phase 3.

> **Architecture boundary:** `RepoIngestionService` is a standalone module. Its output is a `RepoContext` object. The `AnalysisEngine` receives a `RepoContext` and does not care how it was produced. This boundary is critical for Phase 3 optimization.

---

### ADR-004: Results Rendering — Side Panel vs Injected Block vs Separate Page

| | Side Panel | Injected Notion Block | Separate Results Page |
|---|---|---|---|
| **Implementation effort** | Low | High (fragile DOM) | Medium |
| **UX quality** | Excellent — contextual | Excellent — inline | Good but jarring |
| **Notion DOM risk** | None | High (breaks on updates) | None |
| **Persistence** | Cached in storage | Lives in Notion doc | Lives on server |

> **Recommendation: Side Panel.** Chrome's Side Panel API provides a persistent, high-quality UI pane that doesn't depend on Notion's DOM structure. Results are cached locally. The "Resolve Issue" feature (Phase 3+) can use content script to inject into Notion only when explicitly triggered.

---

### ADR-005: Telemetry Platform — PostHog vs Amplitude vs Mixpanel

| | PostHog | Amplitude | Mixpanel |
|---|---|---|---|
| **Free tier** | 1M events/month | 10M events/month | 20M events/month |
| **Open source** | Yes (self-hostable) | No | No |
| **Funnel analysis** | Excellent | Excellent | Excellent |
| **Session replay** | Yes (free tier) | No | No |
| **Feature flags** | Yes | No | No |
| **Self-host option** | Yes (later) | No | No |
| **Setup complexity** | Low | Low | Low |

> **Recommendation: PostHog.** The self-host option is strategically valuable for enterprise customers who will not allow telemetry to leave their network. Session replay aids UX debugging. Feature flags enable progressive rollouts. Free tier is sufficient for MVP.

---

## 10. Phase 0 — Product Skeleton

**Goal:** Thinnest end-to-end prototype. Fake analysis, real UX shell, telemetry wired.

**Duration:** ~1 week

### Deliverables

#### Chrome Extension Shell

```
manifest.json (MV3)
  - permissions: sidePanel, storage, tabs, scripting
  - side_panel: default_path = panel/index.html
  - content_scripts: matches notion.so

background/service-worker.ts
  - onInstalled: generate clientId, fire extension_installed event
  - Handles messages from content script and panel

content/notion-detector.ts
  - Runs on notion.so pages
  - Detects: is this a document page? Does it have substantial text content?
  - Sends message to background: { type: "NOTION_PAGE_DETECTED", pageId, wordCount }
  - Fires: extension_notion_page_detected, prd_page_detected

panel/
  - React app rendered in Chrome Side Panel
  - Reads extension state from chrome.storage.local
  - Displays: Run Check button, progress states, results

telemetry/telemetry.ts
  - Thin wrapper over posthog-js
  - Auto-includes: clientId, extensionVersion, browser, timestamp
  - Exported: track(event, properties)
```

#### Fake Analysis Progress UI

The panel must cycle through these states with realistic timing (mocked delays):

```
State 1: IDLE
  → Button: "Run Congruence Check"
  → Subtitle: "Check PRD alignment with your codebase"

State 2: REPO_SELECTION
  → "Select your repository folder"
  → [Browse...] button (wired to folder picker in Phase 1; mocked in Phase 0)

State 3: RUNNING (4 stages, ~2s each)
  → Stage 1: "Extracting PRD intent..."
  → Stage 2: "Scanning repository..."
  → Stage 3: "Mapping dependencies..."
  → Stage 4: "Detecting incongruences..."

  → Teaser section (shown during Stage 3-4):
    "Coming soon:"
    ⚡ Coverage Analysis — see what % of your PRD has code coverage
    🔍 Impact Analysis — understand blast radius of your changes
    [Join Beta] → opens beta signup form

State 4: RESULTS
  → Summary card: "X issues detected — [readiness badge]"
  → Issue cards (2-3 fake issues for Phase 0)
  → Each card: Summary, Description, Impact, Recommendation
  → Collapsible accordion for Description/Impact/Recommendation
```

#### Mocked Backend Endpoint

```
POST /analysis/run
  → Accepts any body
  → Returns jobId immediately
  → Job transitions to "completed" after 8 seconds (simulated)

GET /analysis/:jobId
  → Returns current mock stage label + completion status
  → After 8s returns fake result with 2-3 mock issues
```

#### Telemetry Wired in Phase 0

All events must be fired even in the mocked phase. This ensures telemetry is validated before real data flows.

Events to wire in Phase 0:
- `extension_installed`
- `extension_first_opened`
- `extension_panel_opened`
- `extension_panel_closed`
- `extension_notion_page_detected`
- `prd_page_detected`
- `run_congruence_check_clicked`
- `analysis_started`
- `analysis_completed`
- `analysis_results_viewed`
- `issue_expanded`

### Phase 0 Success Criteria

- [ ] Extension loads on notion.so without errors
- [ ] Side panel opens and shows correct idle state
- [ ] "Run Congruence Check" triggers animated progress through 4 stages
- [ ] Teaser section shown during analysis
- [ ] Fake results render with 2-3 issue cards
- [ ] All telemetry events visible in PostHog dashboard
- [ ] Extension installs cleanly on a fresh Chrome profile

---

## 11. Phase 1 — Local Repository Support

**Goal:** Real repository reading. Folder picker. Repo memory. No analysis yet.

**Duration:** ~1 week

### Deliverables

#### Folder Picker Integration

```
Flow:
1. User clicks "Select Repository"
2. Extension calls showDirectoryPicker() (File System Access API)
3. User selects local folder in native OS dialog
4. Extension reads directory recursively in background service worker
5. Repo metadata (name, file count, size) shown in panel
6. FileSystemDirectoryHandle stored in IndexedDB via idb library
7. Repo metadata stored in chrome.storage.local
```

#### Repository Filtering Rules

These rules run entirely in the extension before any data leaves the browser.

**Excluded directories** (exact match, any depth):
```
node_modules, .git, dist, build, out, .next, .nuxt, coverage,
vendor, __pycache__, .venv, venv, env, target, .gradle,
.DS_Store, .cache, tmp, temp
```

**Excluded file extensions** (binary and generated):
```
.png, .jpg, .jpeg, .gif, .svg, .ico, .webp, .pdf, .zip,
.tar, .gz, .exe, .dll, .so, .dylib, .bin, .wasm, .map,
.min.js (optional), .lock (package-lock, yarn.lock, etc.)
```

**Included file extensions** (source files only):
```
.ts, .tsx, .js, .jsx, .py, .go, .rs, .java, .kt, .swift,
.rb, .php, .cs, .cpp, .c, .h, .yaml, .yml, .json (non-lock),
.toml, .env.example, .md (README only), .sql, .graphql, .proto
```

#### Repository Size Cap

```
MAX_FILES:       300 files
MAX_TOTAL_CHARS: 500,000 characters (~500KB of source)

If repo exceeds cap:
  - Prioritize files by type: entry points, route definitions, API handlers, models/schemas first
  - Truncate remaining files if needed
  - Show user: "Large repository detected. Analyzing 300 most relevant files."
```

> **MVP Shortcut:** Prioritization logic in Phase 1 is simple: sort by file extension priority list. Semantic relevance scoring is deferred to Phase 3.

#### Repo Memory System

```
On repo selection:
  1. Generate repo ID (UUID)
  2. Store FileSystemDirectoryHandle in IndexedDB (key: repoId)
  3. Store metadata in chrome.storage.local:
     { id, name, path (display only), lastUsedAt }
  4. Update prdRepoBindings: { [notionPageId]: repoId }

On panel open:
  1. Read current notionPageId from content script
  2. Check prdRepoBindings for this pageId
  3. If found: suggest previously used repo → "Continue with: my-app"
  4. If not found: suggest lastUsedRepo → "Use last repo: my-app"
  5. User can override with "Change Repository"

Repo history UI:
  - Shows up to 5 recently used repositories
  - Each entry: repo name, last used date, "Use this" button
```

#### Repo Content Payload

The filtered repo content is structured as follows before being sent to the backend:

```json
{
  "repoName": "my-app",
  "files": [
    {
      "path": "src/api/users.ts",
      "content": "..."
    },
    {
      "path": "src/models/user.model.ts",
      "content": "..."
    }
  ],
  "meta": {
    "totalFiles": 38,
    "totalChars": 124500,
    "filteredFiles": 12,
    "filterReason": "size_cap"
  }
}
```

> **Privacy messaging** (shown in panel during repo selection): "Your repository stays on your machine. Only filtered source files are temporarily transmitted for analysis. Code is never stored."

### Phase 1 Success Criteria

- [ ] Folder picker opens on click
- [ ] Filtered file list shown in panel with file count and estimated size
- [ ] Large repo triggers size cap with user notification
- [ ] Previously used repo suggested on panel reopen
- [ ] PRD ↔ repo binding persists across sessions
- [ ] FileSystemDirectoryHandle successfully re-used without re-picking
- [ ] `repo_selected` telemetry event fires with correct properties

---

## 12. Phase 2 — Real Congruence Analysis

**Goal:** Replace mocked backend with real analysis pipeline.

**Duration:** ~2 weeks

### PRD Extraction

The content script reads the Notion page DOM and extracts structured text.

```
Extraction strategy:
  1. Read all text nodes from the Notion page body
  2. Preserve heading hierarchy (H1, H2, H3) as section markers
  3. Extract bullet lists and numbered lists as-is
  4. Strip navigation, toolbar, and comment elements
  5. Produce a clean plain-text representation with section labels
  6. Truncate at 8,000 tokens if needed (with truncation notice)
```

> **Assumption:** Notion's DOM structure is relatively stable within the main content area. Content script targets `[data-block-id]` elements inside the main scrollable content container. If Notion changes this structure, the detector breaks — this is an accepted risk.

### Backend Analysis Pipeline

```
POST /analysis/run
  ↓
Validate request (clientId, payload structure)
  ↓
Check usage limits (Redis)
  ↓
Create job in Redis (status: "pending")
  ↓
Return jobId to extension immediately
  ↓
Begin async processing:

  Stage 1: "Extracting PRD intent"
    - Parse PRD sections from submitted text
    - Extract: entities, APIs mentioned, user flows, technical requirements
    - LLM call: structured extraction prompt
    - Update job status: stage = 1

  Stage 2: "Scanning repository"
    - Parse submitted repo file list
    - Build lightweight index: file paths, function signatures, export names
    - Pattern match: API route definitions, model names, service names
    - Update job status: stage = 2

  Stage 3: "Mapping dependencies"
    - Cross-reference PRD entities against repo index
    - Build candidate conflict map
    - LLM call: congruence detection prompt with PRD + repo context
    - Update job status: stage = 3

  Stage 4: "Detecting incongruences"
    - Parse LLM response into structured issues
    - Validate and normalize issues
    - Score severity
    - Update job status: stage = 4

  Complete:
    - Write full results to Redis job
    - Update job status: "completed"
```

### Congruence Detection Strategy

We use a **heuristic pre-filter + LLM deep analysis** hybrid:

**Heuristic pre-filter (no LLM, fast):**
```
Check 1 — API existence
  Extract API endpoint mentions from PRD (e.g., "/api/users", "POST /checkout")
  Scan repo for route definitions (Express, FastAPI, etc.)
  Flag: PRD endpoints not found in any route file

Check 2 — Entity existence
  Extract entity/model names from PRD (User, Order, Cart, etc.)
  Scan repo for model/schema files, type definitions
  Flag: PRD entities not found in any model/type/schema file

Check 3 — File naming heuristics
  Look for PRD feature names in file paths
  Flag: No files related to major PRD features
```

**LLM deep analysis (Claude claude-sonnet-4-6):**

The LLM receives:
- Structured PRD (extracted sections + entities)
- Repo context (file tree + key file contents, not full codebase)
- Heuristic pre-filter findings
- System prompt with issue taxonomy and output format

The LLM produces a structured JSON response containing all detected issues.

### Severity Scoring

| Severity | Definition |
|---|---|
| **Critical** | Implementation is impossible without addressing this — missing foundational dependency |
| **High** | Implementation will require significant unplanned work or rearchitecture |
| **Medium** | Implementation is possible but will likely cause confusion, bugs, or scope creep |
| **Low** | Minor ambiguity or assumption that should be clarified |

### Phase 2 Success Criteria

- [ ] PRD text extracted reliably from a real Notion page
- [ ] Repo content filtered and sent to backend
- [ ] Analysis returns real issues from a real PRD/repo pair
- [ ] 4 progress stages reflect real pipeline stages (not fake timers)
- [ ] Results rendered with correct Summary/Description/Impact/Recommendation
- [ ] `analysis_completed` event fires with correct `durationMs` and `issuesFound`
- [ ] Error states handled gracefully (backend timeout, LLM failure)

---

## 13. Phase 3 — Hardening

**Goal:** Demo-ready stability, telemetry dashboards, UX polish, repo ingestion optimization.

**Duration:** ~1.5 weeks

### Reliability Improvements

- Retry logic for LLM API calls (max 2 retries with backoff)
- Graceful degradation: if LLM fails, return heuristic-only results with notice
- Job TTL management: expired jobs show "Analysis expired — run again" state
- Content script resilience: handle Notion SPA navigation (re-detect on route change)
- Handle `FileSystemDirectoryHandle` permission expiry (re-prompt user to re-grant)

### Repo Ingestion Optimization

Replace naive full-file-content ingestion with a smarter extraction approach:

```
Phase 3 ingestion improvements:
  1. Extract signatures only for most files (function names, class names, exports)
  2. Include full content only for: route files, model files, schema files, config files
  3. Build a file-type manifest: { routes: [...], models: [...], services: [...], ... }
  4. Reduce average payload size by ~60-70% while preserving analysis quality
```

> **Architecture note:** Because `RepoIngestionService` is decoupled from `AnalysisEngine`, this optimization requires no changes to the analysis pipeline. Only the ingestion module changes.

### UX Improvements

- Issue count badge on extension icon when results are available
- "Re-run analysis" button (with confirmation if previous results exist)
- Keyboard shortcut to open panel (configurable)
- Results export: "Copy issues as Markdown" button
- PRD readiness score: visual indicator (Ready / Needs Work / High Risk)
- Empty state when no issues found: "Your PRD looks well-aligned"

### Telemetry Dashboards (PostHog)

**Dashboard 1: Extension Adoption Funnel**
```
Funnel:
  extension_installed
  → extension_first_opened
  → extension_notion_page_detected
  → run_congruence_check_clicked
  → analysis_completed
  → analysis_results_viewed

Metrics:
  - Conversion rate at each step
  - Drop-off points
  - Time between steps (median)
```

**Dashboard 2: Product Usage**
```
Metrics:
  - Daily active extension users (unique clientIds with any event)
  - Analyses run per day (count of analysis_started)
  - Analyses per user (analysis_started / unique clientIds)
  - Average analysis duration (mean of analysis_completed.durationMs)
  - Issues per run (mean of analysis_completed.issuesFound)
  - Issue type distribution (breakdown by issue_expanded.issueType)
  - Failure rate (analysis_failed / analysis_started)
```

**Dashboard 3: Repo & PRD Patterns**
```
Metrics:
  - Most common repo sizes (histogram of repoFileCount)
  - PRD word count distribution
  - Analysis duration by repo size (scatter)
  - Overall readiness distribution (ready/needs_work/high_risk breakdown)
```

### Phase 3 Success Criteria

- [ ] Extension handles Notion SPA navigation without page refresh
- [ ] LLM retry and graceful degradation working
- [ ] Telemetry dashboards live in PostHog with real data
- [ ] Repo payload reduced by optimization
- [ ] "Copy as Markdown" export working
- [ ] Clean demo run: install → select repo → run analysis → review results in under 2 minutes

---

## 14. Phase 4 — GitHub Integration

**Goal:** Add remote GitHub repository support via GitHub App.

**Duration:** ~2 weeks

### GitHub App Design

```
GitHub App configuration:
  Name: Alucify Spec Checker
  Permissions:
    - Contents: Read (repository files)
    - Metadata: Read (repo info, default branch)
  Events: None (no webhooks needed for MVP)
  Installation: User or organization installs the App
  Callback URL: https://api.alucify.com/github/callback
```

> **Why GitHub App over OAuth:** A GitHub App installation grants permission at the repo level, not the user level. One install covers the whole org. No per-user token refresh. Installation tokens are short-lived (1hr) and generated server-side only. This model is safer and scales better for team tools.

### Installation Flow

```
User flow:
1. Panel shows "Connect GitHub" option
2. User clicks → opens github.com/apps/alucify-spec-checker/installations/new
3. User selects account/org and repositories to allow
4. GitHub redirects to callback URL with installation_id
5. Backend exchanges installation_id for installation token
6. Backend stores installation mapping (clientId → installationId) in Redis/DB
7. Panel receives confirmation → GitHub repos now available in repo selector

Extension panel adds:
  Repo selector toggle: [Local Folder] [GitHub]
  GitHub tab: list of installed repos with search
```

### Repo Ingestion from GitHub

```
GitHubIngestionService (mirrors LocalIngestionService interface):
  1. List repository tree via GitHub API (recursive)
  2. Apply same filtering rules as local ingestion
  3. Apply same size cap
  4. Fetch file contents for included files (parallel, batched)
  5. Return RepoContext object — identical shape as local ingestion output
```

> **Architecture payoff:** Because `AnalysisEngine` accepts a `RepoContext` regardless of source, adding GitHub ingestion requires only a new `RepoIngestionService` implementation. Zero changes to the analysis pipeline.

### Phase 4 Success Criteria

- [ ] GitHub App created and published
- [ ] Installation flow completes end-to-end
- [ ] GitHub repos appear in repo selector after installation
- [ ] Analysis runs on a GitHub repo with same quality as local
- [ ] Local repo path still works alongside GitHub
- [ ] `github_app_installed`, `github_repo_selected` telemetry events fire

---

## 15. Repository Structure

```
alucify/
├── apps/
│   ├── extension/                    # Chrome Extension (MV3)
│   │   ├── src/
│   │   │   ├── background/
│   │   │   │   └── service-worker.ts
│   │   │   ├── content/
│   │   │   │   └── notion-detector.ts
│   │   │   ├── panel/               # React Side Panel App
│   │   │   │   ├── App.tsx
│   │   │   │   ├── components/
│   │   │   │   │   ├── RunCheckButton.tsx
│   │   │   │   │   ├── ProgressStates.tsx
│   │   │   │   │   ├── ResultsPanel.tsx
│   │   │   │   │   ├── IssueCard.tsx
│   │   │   │   │   ├── RepoSelector.tsx
│   │   │   │   │   └── TeaserSection.tsx
│   │   │   │   └── hooks/
│   │   │   │       ├── useAnalysis.ts
│   │   │   │       └── useRepoMemory.ts
│   │   │   ├── lib/
│   │   │   │   ├── telemetry.ts
│   │   │   │   ├── repo-reader.ts     # File System Access API
│   │   │   │   ├── repo-filter.ts     # Filtering rules
│   │   │   │   ├── repo-storage.ts    # IndexedDB handles
│   │   │   │   └── client-id.ts
│   │   │   └── manifest.json
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── api/                          # Backend API
│       ├── src/
│       │   ├── server.ts             # Fastify app
│       │   ├── routes/
│       │   │   ├── analysis.routes.ts
│       │   │   └── telemetry.routes.ts
│       │   ├── services/
│       │   │   ├── analysis.service.ts
│       │   │   ├── ingestion/
│       │   │   │   ├── ingestion.interface.ts  # RepoContext type
│       │   │   │   ├── local.ingestion.ts      # Phase 1-3
│       │   │   │   └── github.ingestion.ts     # Phase 4
│       │   │   ├── prd-extractor.ts
│       │   │   ├── congruence-engine.ts
│       │   │   └── result-formatter.ts
│       │   ├── prompts/
│       │   │   ├── prd-extraction.prompt.ts
│       │   │   └── congruence-analysis.prompt.ts
│       │   ├── lib/
│       │   │   ├── redis.ts
│       │   │   ├── anthropic.ts
│       │   │   ├── telemetry.ts      # posthog-node
│       │   │   └── safeguards.ts     # usage enforcement
│       │   └── types/
│       │       └── analysis.types.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── shared-types/                 # Shared TypeScript types
│       ├── src/
│       │   ├── analysis.types.ts     # Issue, Result, RepoContext
│       │   └── telemetry.types.ts    # Event definitions
│       └── package.json
│
├── docs/
│   └── implementation-plan.md
│
├── package.json                      # Turborepo / pnpm workspace root
└── turbo.json
```

---

## 16. API Endpoints

### `POST /analysis/run`

Submit a new congruence analysis job.

```
Headers:
  X-Client-ID: <uuid>
  Content-Type: application/json

Body:
{
  "notionPageId": "string",
  "prdText": "string",               // max 8000 tokens
  "repo": {
    "name": "string",
    "files": [
      { "path": "string", "content": "string" }
    ],
    "meta": { "totalFiles": number, "totalChars": number }
  }
}

Response 202:
{
  "jobId": "uuid",
  "status": "pending"
}

Response 429:
{
  "error": "daily_limit_reached",
  "message": "You've reached the daily analysis limit. Try again tomorrow."
}
```

### `GET /analysis/:jobId`

Poll for job status and results.

```
Headers:
  X-Client-ID: <uuid>

Response 200 (in progress):
{
  "jobId": "uuid",
  "status": "running",
  "stage": 2,
  "stageLabel": "Scanning repository..."
}

Response 200 (complete):
{
  "jobId": "uuid",
  "status": "completed",
  "result": { ...full AnalysisResult object... }
}

Response 200 (failed):
{
  "jobId": "uuid",
  "status": "failed",
  "error": "analysis_error",
  "message": "Analysis could not be completed. Please try again."
}

Response 404:
  Job not found or expired
```

### `POST /telemetry/events` *(Phase 3+)*

Proxy telemetry through backend to avoid AdBlocker suppression.

```
Headers:
  X-Client-ID: <uuid>

Body:
{
  "events": [
    {
      "event": "string",
      "properties": { ... },
      "timestamp": "ISO8601"
    }
  ]
}

Response 200: { "ok": true }
```

---

## 17. Prompting Strategy for LLM Analysis

### Prompt 1: PRD Structured Extraction

**Purpose:** Extract structured intent from raw PRD text before congruence analysis.

**Input:** Raw PRD text
**Output:** Structured JSON with entities, APIs, flows, requirements

```
System:
  You are a technical analyst. Extract structured technical requirements from a
  Product Requirements Document.

  Return a JSON object with these fields:
  - entities: string[]               // Domain model names (User, Order, Product, etc.)
  - apiEndpoints: string[]           // Specific API calls or endpoints mentioned
  - userFlows: string[]              // Named user journeys or workflows
  - technicalRequirements: string[]  // Specific technical constraints or integrations
  - assumptions: string[]            // Implicit technical assumptions the PRD makes

  Be specific. Extract only what is explicitly or clearly implicitly stated.

User:
  <prd_text>
```

### Prompt 2: Congruence Analysis

**Purpose:** Identify misalignments between PRD intent and codebase reality.

**Input:** Structured PRD + repo context + heuristic findings
**Output:** Structured issue list

```
System:
  You are a senior software engineer reviewing a Product Requirements Document (PRD)
  for technical congruence with an existing codebase before AI implementation.

  Your job is to identify specific misalignments — places where the PRD assumes
  something that either doesn't exist in the codebase, conflicts with existing
  patterns, or is ambiguous enough to cause implementation problems.

  Issue types to check:
  - missing_api: PRD references an API endpoint or external service that doesn't exist
  - missing_entity: PRD references a data model or concept not present in the codebase
  - state_conflict: PRD describes a state that contradicts existing application states
  - workflow_conflict: PRD describes a flow that conflicts with existing implementations
  - ambiguous_reference: PRD references something too vague to implement without clarification
  - scope_gap: PRD assumes pre-existing functionality that doesn't appear to exist yet

  For each issue, return:
  {
    "type": "<issue_type>",
    "severity": "critical|high|medium|low",
    "summary": "<15 words max — PM-friendly title>",
    "description": "<2-3 sentences — plain English, no jargon>",
    "impact": "<1-2 sentences — what goes wrong if unresolved>",
    "recommendation": "<1-3 sentences — specific actionable guidance for the PM>",
    "prdContext": "<brief quote or paraphrase from PRD>",
    "codeContext": "<file path or function name — NO raw source code>"
  }

  Rules:
  - Do NOT include raw source code in any field
  - Do NOT invent issues not supported by evidence
  - Focus on issues that will affect an AI coding agent's implementation
  - If PRD and codebase appear well-aligned, return an empty issues array
  - Return: { "issues": [...], "overallReadiness": "ready|needs_work|high_risk" }

User:
  ## PRD Summary
  <structured_prd_json>

  ## Repository Context
  ### File Tree
  <file_tree>

  ### Key Source Files
  <filtered_file_contents>

  ## Heuristic Pre-Filter Findings
  <heuristic_findings>

  Identify all congruence issues.
```

> **Recommendation:** Use `claude-sonnet-4-6` for both prompts. Set `max_tokens: 4096` for analysis output. Parse JSON from response with a try/catch fallback.

---

## 18. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **Notion DOM structure changes** | Medium | High — content script breaks | Target `[data-block-id]` selectors; add monitoring; consider Notion API as fallback in Phase 4 |
| **File System Access API permissions expire** | Medium | Medium — user must re-grant | Handle `NotAllowedError`, prompt gracefully: "Please re-select your repository folder" |
| **LLM output format inconsistency** | Medium | Medium — parse failure | Robust JSON parsing with fallback; validate schema; log raw LLM output for debugging |
| **Large repo exceeds token limits** | High | Medium — analysis degraded | Enforce size cap strictly; optimize ingestion in Phase 3; show user what was included/excluded |
| **Extension blocked by Chrome managed policy** | Low | High for enterprise users | Document alternative (Notion API in Phase 4); consider Firefox port |
| **PostHog blocked by AdBlockers** | Medium | Low — telemetry incomplete | Proxy through backend in Phase 3; use server-side events for critical funnel metrics |
| **LLM cost overrun** | Medium | Medium — unit economics | Usage cap per clientId limits exposure; track cost per run via analysis duration |
| **Chrome Web Store review delay** | Low-Medium | High — blocks distribution | Submit early; use developer mode for demos; maintain side-load instructions |
| **GitHub App approval process** | Low | Medium — delays Phase 4 | Submit GitHub App early in Phase 3 even before implementation is complete |

---

## 19. Recommended Build Order

Execute in this sequence to maximize momentum and minimize wasted work:

```
Week 1 — Phase 0
  Day 1-2: Extension scaffold (manifest, service worker, content script, side panel shell)
  Day 2-3: Telemetry integration (PostHog, clientId, base events)
  Day 3-4: Fake progress UI (4 stages, teaser section, beta CTA)
  Day 4-5: Fake results UI (issue cards, accordion, readiness badge)
  Day 5:   Mocked backend (Fastify, Redis, fake job transitions)
  Day 5:   Phase 0 demo run + smoke test

Week 2 — Phase 1
  Day 1-2: Folder picker + recursive file reader
  Day 2-3: Filtering rules + size cap
  Day 3-4: IndexedDB handle storage + repo memory
  Day 4-5: Repo selector UI + PRD↔repo binding
  Day 5:   Phase 1 smoke test + telemetry validation

Week 3-4 — Phase 2
  Day 1-2: PRD extraction (content script → structured text)
  Day 2-3: Backend analysis pipeline (stages 1-4 as real async steps)
  Day 3-5: LLM prompts (extraction + congruence analysis)
  Day 5-6: Result formatter + issue normalization
  Day 6-7: Wire frontend to real backend
  Day 7-8: End-to-end test on real PRD + real repo
  Day 8-10: Polish, error states, edge cases

Week 5-6 — Phase 3
  Day 1-3: Reliability (retry, graceful degradation, handle permission expiry)
  Day 3-5: Repo ingestion optimization (signature extraction)
  Day 5-7: Telemetry dashboards (PostHog setup)
  Day 7-8: UX polish (badge, export, re-run, readiness score)
  Day 8-10: Demo preparation + golden fixture test

Week 7-8 — Phase 4
  Day 1-2: GitHub App setup + installation flow
  Day 3-5: GitHub ingestion service
  Day 5-7: Repo selector GitHub tab
  Day 7-10: Parity testing + polish
```

---

## Summary Labels Reference

| Label | Meaning |
|---|---|
| **Recommendation** | The chosen approach with justification |
| **Assumption** | Something taken as true that should be validated |
| **Risk** | An identified threat requiring active management |
| **MVP Shortcut** | A deliberate simplification acceptable for V1 |
| **Defer to Later** | Valid capability explicitly out of scope for MVP |

---

## Deferred Items (Not in any phase above)

- User accounts and sign-in
- Team workspaces and shared analysis history
- "Resolve Issue" PRD editing feature
- Semantic code graph extraction
- Notion API integration (as alternative to extension)
- Firefox extension port
- Mobile / tablet support
- Persistent analysis database
- Multi-language LLM support
- Webhook-based automatic re-analysis on repo push
