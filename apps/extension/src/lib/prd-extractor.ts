// Extracts structured plain-text from a Notion page DOM.
// Preserves heading hierarchy and list structure.
// Strips navigation, toolbar, comments, and sidebar elements.

const MAX_CHARS = 32_000; // ~8k tokens at ~4 chars/token

interface Block {
  type: "h1" | "h2" | "h3" | "text" | "bullet" | "numbered" | "code" | "divider";
  text: string;
}

export function extractPrdText(): string {
  const blocks = extractBlocks();
  const lines = blocks.map(formatBlock).filter(Boolean);
  let result = lines.join("\n");

  if (result.length > MAX_CHARS) {
    result = result.slice(0, MAX_CHARS);
    result += "\n\n[Content truncated at 32,000 characters]";
  }

  return result.trim();
}

function extractBlocks(): Block[] {
  // Target Notion's block elements by data-block-id
  const blockEls = document.querySelectorAll<HTMLElement>("[data-block-id]");
  if (blockEls.length === 0) {
    // Fallback: read from page content container
    return extractFallback();
  }

  const blocks: Block[] = [];
  for (const el of blockEls) {
    const block = parseBlock(el);
    if (block) blocks.push(block);
  }
  return blocks;
}

function parseBlock(el: HTMLElement): Block | null {
  // Skip non-content elements
  if (el.closest(".notion-sidebar, .notion-topbar, .notion-comments, nav")) return null;

  const text = (el.innerText ?? el.textContent ?? "").trim();
  if (!text) return null;

  // Detect heading level via aria role or class
  const role = el.getAttribute("data-content-editable-leaf") ?? "";
  const tag = el.tagName.toLowerCase();
  const classList = el.className ?? "";

  if (isHeading(el, 1)) return { type: "h1", text };
  if (isHeading(el, 2)) return { type: "h2", text };
  if (isHeading(el, 3)) return { type: "h3", text };
  if (isBullet(el)) return { type: "bullet", text };
  if (isNumbered(el)) return { type: "numbered", text };
  if (isCode(el)) return { type: "code", text };
  if (isDivider(el)) return { type: "divider", text: "---" };

  return { type: "text", text };
}

function isHeading(el: HTMLElement, level: 1 | 2 | 3): boolean {
  const placeholder = el.getAttribute("data-placeholder") ?? "";
  const headingPlaceholders: Record<number, string[]> = {
    1: ["Heading 1", "Title"],
    2: ["Heading 2"],
    3: ["Heading 3"],
  };
  if (headingPlaceholders[level].some((p) => placeholder.includes(p))) return true;

  // Check parent block type via Notion's internal class naming
  const blockType = getNotionBlockType(el);
  return blockType === `header` && level === 1
    || blockType === `sub_header` && level === 2
    || blockType === `sub_sub_header` && level === 3;
}

function isBullet(el: HTMLElement): boolean {
  return getNotionBlockType(el) === "bulleted_list";
}

function isNumbered(el: HTMLElement): boolean {
  return getNotionBlockType(el) === "numbered_list";
}

function isCode(el: HTMLElement): boolean {
  return getNotionBlockType(el) === "code" || !!el.closest("pre, code");
}

function isDivider(el: HTMLElement): boolean {
  return getNotionBlockType(el) === "divider";
}

function getNotionBlockType(el: HTMLElement): string {
  // Walk up to find the notion block container and read its type
  let cursor: HTMLElement | null = el;
  while (cursor) {
    const blockType = cursor.getAttribute("data-block-type") ?? "";
    if (blockType) return blockType;
    // Try class-based detection
    const cls = cursor.className ?? "";
    const match = cls.match(/notion-(\w+)-block/);
    if (match) return match[1];
    cursor = cursor.parentElement;
    if (cursor?.getAttribute("data-block-id") !== null && cursor !== el) break;
  }
  return "";
}

function formatBlock(block: Block): string {
  switch (block.type) {
    case "h1": return `\n# ${block.text}\n`;
    case "h2": return `\n## ${block.text}\n`;
    case "h3": return `\n### ${block.text}\n`;
    case "bullet": return `• ${block.text}`;
    case "numbered": return `- ${block.text}`;
    case "code": return `\`\`\`\n${block.text}\n\`\`\``;
    case "divider": return "\n---\n";
    case "text": return block.text;
    default: return block.text;
  }
}

function extractFallback(): Block[] {
  // Fallback: grab all text from the page content area
  const container =
    document.querySelector(".notion-page-content") ??
    document.querySelector(".notion-scroller") ??
    document.body;

  const text = (container as HTMLElement).innerText ?? container.textContent ?? "";
  return [{ type: "text", text: text.trim() }];
}
