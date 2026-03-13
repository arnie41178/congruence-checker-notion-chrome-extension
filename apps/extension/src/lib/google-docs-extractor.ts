// Extracts plain text from a Google Docs document using the export API.
// Fetches /export?format=txt which returns clean text without UI chrome.
// This is more reliable than DOM scraping since the editor canvas lives inside iframes.

const MAX_CHARS = 32_000;

export async function extractGoogleDocsText(docId: string): Promise<string> {
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Google Docs export failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (text.length > MAX_CHARS) {
    return text.slice(0, MAX_CHARS) + "\n\n[Content truncated at 32,000 characters]";
  }
  return text.trim();
}
