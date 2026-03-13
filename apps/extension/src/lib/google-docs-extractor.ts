// Extracts structured plain-text from a Google Docs page DOM (edit mode).
// Targets .kix-paragraphrenderer elements inside the document canvas.

const MAX_CHARS = 32_000;

export function extractGoogleDocsText(): string {
  const paragraphs = document.querySelectorAll<HTMLElement>(".kix-paragraphrenderer");

  if (paragraphs.length === 0) {
    // Fallback: grab from the doc content area directly
    const container =
      document.querySelector<HTMLElement>(".kix-appview-editor") ??
      document.querySelector<HTMLElement>(".docs-editor-container") ??
      document.body;
    const text = (container.innerText ?? container.textContent ?? "").trim();
    return text.slice(0, MAX_CHARS);
  }

  const lines: string[] = [];

  for (const para of paragraphs) {
    const text = (para.innerText ?? para.textContent ?? "").trim();
    if (!text) continue;

    const formatted = formatGoogleDocsParagraph(para, text);
    lines.push(formatted);
  }

  let result = lines.join("\n");
  if (result.length > MAX_CHARS) {
    result = result.slice(0, MAX_CHARS) + "\n\n[Content truncated at 32,000 characters]";
  }

  return result.trim();
}

/**
 * Detect heading level from a Google Docs paragraph element.
 * Google Docs applies named styles as aria-labels on the line element,
 * or as data attributes. Falls back to font-size heuristic.
 */
function formatGoogleDocsParagraph(el: HTMLElement, text: string): string {
  // Check aria-label on the paragraph or its children for heading style
  const lineEl = el.querySelector<HTMLElement>("[data-heading-id], .kix-lineview");
  const ariaLabel = el.getAttribute("aria-label") ?? lineEl?.getAttribute("aria-label") ?? "";

  if (/heading 1|title/i.test(ariaLabel)) return `\n# ${text}\n`;
  if (/heading 2|subtitle/i.test(ariaLabel)) return `\n## ${text}\n`;
  if (/heading 3/i.test(ariaLabel)) return `\n### ${text}\n`;

  // Font-size heuristic via computed style on first text span
  const span = el.querySelector<HTMLElement>(".kix-wordunstyled-content, span[style]");
  if (span) {
    const fontSize = parseFloat(getComputedStyle(span).fontSize ?? "0");
    if (fontSize >= 24) return `\n# ${text}\n`;
    if (fontSize >= 18) return `\n## ${text}\n`;
    if (fontSize >= 14) return `\n### ${text}\n`;
  }

  // Bullet/list detection via list item containers
  if (el.closest(".kix-list") || el.querySelector(".kix-listitem")) {
    return `• ${text}`;
  }

  return text;
}
