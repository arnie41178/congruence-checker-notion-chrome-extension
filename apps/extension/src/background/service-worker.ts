import { getOrCreateClientId } from "../lib/client-id";
import { initTelemetry, track } from "../lib/telemetry";
import { runLocalPipeline } from "../lib/local-pipeline";
import type { ClaudeInvoker } from "../lib/local-pipeline";
import type { RepoContext } from "@alucify/shared-types";

// ── Claude invoker factories ──────────────────────────────────────────────────

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const LOCAL_MODEL = "claude-opus-4-6";
const COMPANION_HOST = "com.alucify.companion";

/** Invoker that calls Anthropic API directly using the user's API key. */
function makeApiKeyInvoker(apiKey: string): ClaudeInvoker {
  return async (system, prompt, maxTokens = 2048) => {
    const MAX_RETRIES = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(ANTHROPIC_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: LOCAL_MODEL,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => res.statusText);
          throw new Error(`Anthropic API error ${res.status}: ${body}`);
        }
        const data = await res.json() as { content: Array<{ type: string; text: string }> };
        return data.content[0]?.type === "text" ? data.content[0].text : "";
      } catch (err: unknown) {
        lastErr = err;
        const msg = String(err);
        const isTransient = msg.includes("529") || msg.includes("503") || msg.includes("502");
        if (isTransient && attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, attempt * 5000));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };
}

/** Invoker that routes calls through the native messaging companion (claude CLI). */
function makeCompanionInvoker(): ClaudeInvoker {
  return (system, prompt) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(
        COMPANION_HOST,
        { system, prompt, model: LOCAL_MODEL },
        (response: { text?: string; error?: string } | undefined) => {
          if (chrome.runtime.lastError) {
            reject(new Error(
              `Companion not available: ${chrome.runtime.lastError.message}. ` +
              "Run: npx @alucify/companion install"
            ));
            return;
          }
          if (response?.error) {
            reject(new Error(response.error));
            return;
          }
          resolve(response?.text ?? "");
        }
      );
    });
}

// ── Remote config cache ───────────────────────────────────────────────────────

interface RemoteConfig {
  analysisMethod: "pipeline" | "fast";
  consensusRuns: number;
}

let cachedConfig: RemoteConfig | null = null;

async function getRemoteConfig(): Promise<RemoteConfig> {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      cachedConfig = await res.json() as RemoteConfig;
      return cachedConfig;
    }
  } catch {
    // fall through to default
  }
  return { analysisMethod: "pipeline", consensusRuns: 5 };
}

// ── Local job store (in-memory, lives as long as SW is alive) ─────────────────
interface LocalJobState {
  jobId: string;
  status: "running" | "completed" | "failed";
  stage?: number;
  stageLabel?: string;
  result?: unknown;
  message?: string;
}
const localJobs = new Map<string, LocalJobState>();

const API_BASE = (self as unknown as { VITE_API_BASE?: string }).VITE_API_BASE
  ?? "http://localhost:3001";

const VITE_NOTION_CLIENT_ID = import.meta.env.VITE_NOTION_CLIENT_ID as string ?? "";

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  const clientId = await getOrCreateClientId();
  initTelemetry(clientId);
  return clientId;
}

let clientIdPromise = bootstrap();

// ── Lifecycle ─────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await clientIdPromise;
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    track("extension_installed");
    await chrome.storage.local.set({ alucify_first_install: true });
  }
  // Open side panel when action icon is clicked
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Register context menu item for Notion selection review
  chrome.contextMenus.create({
    id: "alucify-technical-review",
    title: "Technical Review",
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.notion.so/*"],
  });
});

// ── Context menu ───────────────────────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "alucify-technical-review" || !tab?.windowId) return;
  chrome.storage.local.set({ pendingSelection: info.selectionText ?? "" });
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Message handling ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Alucify SW] Message received:", message.type);
  handleMessage(message).then(sendResponse).catch((err) => {
    console.error("[Alucify SW] Message error:", err);
    sendResponse({ error: String(err) });
  });
  return true; // keep channel open
});

async function handleMessage(message: Record<string, unknown>) {
  const clientId = await clientIdPromise;

  switch (message.type) {
    case "NOTION_PAGE_DETECTED": {
      const { pageId, wordCount, prdText } = message as { type: string; pageId: string; wordCount: number; prdText?: string };
      track("extension_notion_page_detected", { notionPageId: pageId, wordCount });
      if (wordCount > 200) {
        track("prd_page_detected", { notionPageId: pageId, wordCount });
      }
      await chrome.storage.local.set({ currentNotionPageId: pageId, currentPrdText: prdText ?? "" });
      return { ok: true };
    }

    case "START_ANALYSIS": {
      const { notionPageId, repo, prdText: explicitPrdText } = message as { type: string; notionPageId: string; repo?: RepoContext; prdText?: string };
      track("run_congruence_check_clicked", { notionPageId });

      const stored = await chrome.storage.local.get(["currentPrdText", "alucify_mode", "alucify_api_key"]);
      const mode = (stored.alucify_mode as string) ?? "remote";
      const cachedPrdText = (stored.currentPrdText as string) ?? "";

      // If prdText was explicitly passed (e.g. from a selection review), use it directly.
      // Otherwise extract fresh from the active tab, falling back to cached.
      let prdText: string;
      if (explicitPrdText) {
        prdText = explicitPrdText;
      } else {
        prdText = await extractPrdTextFromActiveTab();
        if (prdText.trim().length < 50) {
          prdText = cachedPrdText;
        }
      }
      console.log(`[Alucify SW] START_ANALYSIS mode=${mode} notionPageId=${notionPageId} freshPrdLength=${prdText.length} cachedPrdLength=${cachedPrdText.length} repoFiles=${repo?.files?.map(f => f.path)}`);

      if (mode === "local" || mode === "local-companion") {
        let invoker: ClaudeInvoker;
        if (mode === "local-companion") {
          invoker = makeCompanionInvoker();
        } else {
          const apiKey = (stored.alucify_api_key as string) ?? "";
          if (!apiKey) throw new Error("No API key configured. Open Settings to add your Anthropic API key.");
          invoker = makeApiKeyInvoker(apiKey);
        }
        const jobId = crypto.randomUUID();
        localJobs.set(jobId, { jobId, status: "running", stage: 1, stageLabel: "Extracting requirements..." });
        runLocalPipeline(jobId, notionPageId, prdText, repo ?? { name: "unknown", files: [], meta: { totalFiles: 0, totalChars: 0 } }, invoker, (progress) => {
          localJobs.set(jobId, { ...localJobs.get(jobId)!, ...progress });
        }).then((result) => {
          localJobs.set(jobId, { jobId, status: "completed", result });
        }).catch((err) => {
          localJobs.set(jobId, { jobId, status: "failed", message: String(err) });
        });
        track("analysis_started", { notionPageId, jobId, prdLength: prdText.length, mode });
        return { jobId };
      }

      // Remote mode: route to pipeline or fast based on server config
      const config = await getRemoteConfig();
      if (config.analysisMethod === "pipeline") {
        const jobId = await startPipelineJob(prdText, repo);
        track("analysis_started", { notionPageId, jobId, prdLength: prdText.length, mode: "pipeline" });
        return { jobId };
      }

      const jobId = await startAnalysis(clientId, notionPageId, prdText, repo);
      track("analysis_started", { notionPageId, jobId, prdLength: prdText.length, mode: "remote" });
      return { jobId };
    }

    case "GET_JOB_STATUS": {
      const { jobId } = message as { type: string; jobId: string };

      // Check local jobs first
      const localJob = localJobs.get(jobId);
      if (localJob) {
        if (localJob.status === "completed") {
          track("analysis_completed", { jobId, issueCount: (localJob.result as { issueCount?: number })?.issueCount, badge: (localJob.result as { badge?: string })?.badge });
        }
        return localJob;
      }

      const status = await pollJob(clientId, jobId);
      if (status.status === "completed") {
        track("analysis_completed", {
          jobId,
          issueCount: status.result?.issueCount,
          badge: status.result?.badge,
        });
      }
      return status;
    }

    case "GET_CONFIG": {
      const config = await getRemoteConfig();
      return config;
    }

    case "PANEL_OPENED": {
      const isFirst = await isFirstOpen();
      if (isFirst) track("extension_first_opened");
      track("extension_panel_opened");
      return { ok: true };
    }

    case "PANEL_CLOSED": {
      track("extension_panel_closed");
      return { ok: true };
    }

    case "TRACK": {
      const { event, properties } = message as { type: string; event: string; properties?: Record<string, unknown> };
      track(event as Parameters<typeof track>[0], properties);
      return { ok: true };
    }

    case "NOTION_AUTH": {
      const redirectUri = chrome.identity.getRedirectURL();
      const clientId = VITE_NOTION_CLIENT_ID ?? "";
      const authUrl = `https://api.notion.com/v1/oauth/authorize?client_id=${clientId}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(redirectUri)}`;
      console.log("[Alucify SW] NOTION_AUTH clientId:", clientId, "redirectUri:", redirectUri);

      const responseUrl: string = await new Promise((resolve, reject) =>
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true },
          (url) => url ? resolve(url) : reject(new Error(chrome.runtime.lastError?.message ?? "Auth flow failed")))
      );

      const code = new URL(responseUrl).searchParams.get("code");
      if (!code) throw new Error("No auth code returned from Notion.");

      const res = await fetch(`${API_BASE}/auth/notion/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirectUri }),
      });
      if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
      const data = await res.json() as { access_token: string; workspace_name: string };
      await chrome.storage.local.set({
        alucify_notion_token: data.access_token,
        alucify_notion_workspace: data.workspace_name,
      });
      return { ok: true, workspace: data.workspace_name };
    }

    case "APPLY_CHANGES": {
      const { notionPageId: msgPageId, diffs } = message as { type: string; notionPageId: string | null; diffs: Array<{ issueId: string; sectionTitle: string; before: string; after: string }> };
      // If panel state didn't have the page ID, extract it fresh from the active tab URL
      let notionPageId: string | null = msgPageId;
      if (!notionPageId) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url ?? "";
        const match =
          url.match(/notion\.so[^?#]*\/[^?#]*-([0-9a-f]{32})(?:[?#]|$)/i) ??
          url.match(/notion\.so[^?#]*\/([0-9a-f]{32})(?:[?#]|$)/i) ??
          url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
        notionPageId = match ? match[1] : null;
      }
      if (!notionPageId) return { applied: 0, errors: ["Notion page ID not detected. Navigate to your Notion page and re-detect it before applying changes."], appliedIssueIds: [] };

      // Validate that the page ID is a standard Notion UUID (32 hex or hyphenated UUID)
      const isValidNotionId = /^[0-9a-f]{32}$/i.test(notionPageId) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notionPageId);
      if (!isValidNotionId) {
        // Clear stale/invalid ID so re-detection picks up a fresh one
        await chrome.storage.local.remove("currentNotionPageId");
        return {
          applied: 0,
          errors: ["Notion page URL format is not supported. Please refresh your Notion page, click the green 'Notion Page Detected' button to re-detect, then try again."],
          appliedIssueIds: [],
        };
      }

      let stored = await chrome.storage.local.get("alucify_notion_token");
      let token = stored.alucify_notion_token as string;

      if (!token) {
        await handleMessage({ type: "NOTION_AUTH" });
        stored = await chrome.storage.local.get("alucify_notion_token");
        token = stored.alucify_notion_token as string;
        if (!token) throw new Error("Notion authorization was cancelled.");
      }

      const blocks = await fetchAllNotionBlocks(token, notionPageId);
      let applied = 0;
      const errors: string[] = [];
      const appliedIssueIds: string[] = [];

      for (const diff of diffs) {
        try {
          if (!diff.before) {
            const heading = blocks.find((b) => getNotionBlockText(b).toLowerCase().includes(diff.sectionTitle.toLowerCase()));
            const parentId = heading?.parentId ?? notionPageId;
            const afterId = heading?.id;
            await appendNotionBlock(token, parentId, diff.after, afterId);
          } else {
            const normalizedBefore = normalizeWS(diff.before);
            // Try full match first, then fall back to first 80 chars (handles multi-block text)
            let block = blocks.find((b) => normalizeWS(getNotionBlockText(b)).includes(normalizedBefore));
            const shortBefore = normalizedBefore.slice(0, 80);
            if (!block && normalizedBefore.length > 80) {
              block = blocks.find((b) => normalizeWS(getNotionBlockText(b)).includes(shortBefore));
            }
            if (!block) { errors.push(`Text not found: "${diff.before.slice(0, 40)}..."`); continue; }
            const blockText = normalizeWS(getNotionBlockText(block));
            const matchKey = blockText.includes(normalizedBefore) ? normalizedBefore : shortBefore;
            const newText = blockText.replace(matchKey, normalizeWS(diff.after));
            await updateNotionBlock(token, block.id, block.type, newText);
          }
          applied++;
          if (!appliedIssueIds.includes(diff.issueId)) appliedIssueIds.push(diff.issueId);
        } catch (e) {
          errors.push(String(e));
        }
      }
      return { applied, errors, appliedIssueIds };
    }

    default:
      return { error: "unknown_message_type" };
  }
}

async function isFirstOpen(): Promise<boolean> {
  const result = await chrome.storage.local.get("alucify_first_open_done");
  if (result.alucify_first_open_done) return false;
  await chrome.storage.local.set({ alucify_first_open_done: true });
  return true;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function startPipelineJob(prdContent: string, repo?: RepoContext): Promise<string> {
  const res = await fetch(`${API_BASE}/analysis/pipeline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prdContent, repo }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Pipeline API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

async function startAnalysis(
  clientId: string,
  notionPageId: string,
  prdText: string,
  repo?: RepoContext
): Promise<string> {
  const body = {
    notionPageId,
    prdText,
    repo: repo ?? { name: "mock", files: [], meta: { totalFiles: 0, totalChars: 0 } },
  };
  const res = await fetch(`${API_BASE}/analysis/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-ID": clientId },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as { jobId: string };
  return data.jobId;
}

async function extractPrdTextFromActiveTab(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";

  // First try: send message to content script (if already injected)
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PRD_TEXT" }) as { prdText: string } | undefined;
    const text = response?.prdText ?? "";
    if (text.length > 0) {
      await chrome.storage.local.set({ currentPrdText: text });
      console.log(`[Alucify SW] PRD via content script: ${text.length} chars`);
      return text;
    }
  } catch {
    console.warn("[Alucify SW] Content script not reachable, falling back to executeScript");
  }

  // Fallback: inject script directly into the tab (handles tabs open before extension load)
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const MAX_CHARS = 32_000;
        const blockEls = document.querySelectorAll<HTMLElement>("[data-block-id]");
        const lines: string[] = [];
        if (blockEls.length > 0) {
          for (const el of blockEls) {
            if (el.closest(".notion-sidebar, .notion-topbar, .notion-comments, nav")) continue;
            const text = (el.innerText ?? el.textContent ?? "").trim();
            if (text) lines.push(text);
          }
        } else {
          const container =
            document.querySelector(".notion-page-content") ??
            document.querySelector(".notion-scroller") ??
            document.querySelector("[role='main']") ??
            document.body;
          const text = ((container as HTMLElement).innerText ?? container.textContent ?? "").trim();
          if (text) lines.push(text);
        }
        let result = lines.join("\n").slice(0, MAX_CHARS);
        return result;
      },
    });
    const text = (results?.[0]?.result as string) ?? "";
    if (text.length > 0) {
      await chrome.storage.local.set({ currentPrdText: text });
      console.log(`[Alucify SW] PRD via executeScript: ${text.length} chars`);
    }
    return text;
  } catch (err) {
    console.warn("[Alucify SW] executeScript extraction failed:", err);
    return "";
  }
}

async function pollJob(clientId: string, jobId: string) {
  const res = await fetch(`${API_BASE}/analysis/${jobId}`, {
    headers: { "X-Client-ID": clientId },
  });
  if (!res.ok) {
    // Return a JobState-shaped object so the frontend's !job.status check
    // doesn't misfire — let the frontend handle the error explicitly
    return { status: "failed", message: res.status === 404 ? "Job not found or expired." : `Server error ${res.status}` };
  }
  return res.json();
}

// ── Notion API helpers ─────────────────────────────────────────────────────────

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  parentId?: string;
  [key: string]: unknown;
}

async function fetchAllNotionBlocks(token: string, blockId: string, parentId?: string): Promise<NotionBlock[]> {
  const res = await fetch(`${NOTION_BASE}/blocks/${blockId}/children?page_size=100`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(`Notion API error: ${err.message ?? res.statusText}`);
  }
  const data = await res.json() as { results: NotionBlock[] };
  const blocks = (data.results ?? []).map((b) => ({ ...b, parentId: parentId ?? blockId }));
  const nested = await Promise.all(
    blocks.filter((b) => b.has_children).map((b) => fetchAllNotionBlocks(token, b.id, blockId))
  );
  return [...blocks, ...nested.flat()];
}

function getNotionBlockText(block: NotionBlock): string {
  const content = block[block.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
  return (content?.rich_text ?? []).map((rt) => rt.plain_text).join("");
}

function normalizeWS(text: string): string {
  return text
    .replace(/[\u2018\u2019\u02BC]/g, "'")   // smart single quotes → '
    .replace(/[\u201C\u201D\u201E]/g, '"')   // smart double quotes → "
    .replace(/[\u00A0\u2009\u202F]/g, " ")   // non-breaking/thin spaces → space
    .replace(/\s+/g, " ")
    .trim();
}

async function updateNotionBlock(token: string, blockId: string, blockType: string, newText: string) {
  const res = await fetch(`${NOTION_BASE}/blocks/${blockId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ [blockType]: { rich_text: [{ type: "text", text: { content: newText } }] } }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function appendNotionBlock(token: string, parentId: string, text: string, afterId?: string) {
  const body: Record<string, unknown> = {
    children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } }],
  };
  if (afterId) body.after = afterId;
  const res = await fetch(`${NOTION_BASE}/blocks/${parentId}/children`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}
