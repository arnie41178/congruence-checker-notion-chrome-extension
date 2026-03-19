export const PRD_EXTRACTION_SYSTEM = `You are a technical analyst specializing in product requirements documents (PRDs).
Your task is to extract structured technical requirements from a PRD.

Extract and return a JSON object with these fields:
- entities: string[] — domain model names (User, Order, Cart, Payment, etc.)
- apiEndpoints: string[] — API routes mentioned (e.g. POST /api/checkout, GET /users/:id)
- userFlows: string[] — named user journeys or features (e.g. "User Registration", "Checkout Flow")
- techRequirements: string[] — specific technical requirements (e.g. "real-time updates", "OAuth2 login")
- integrations: string[] — external services mentioned (e.g. Stripe, SendGrid, Firebase)

When a Codebase Symbol Graph is provided, use it to:
- Align entity names with existing interface and type names in the graph (prefer the codebase's terminology)
- Identify which mentioned API endpoints already exist in the call graph vs are new
- Recognise existing integrations already wired in the import dependencies

Return ONLY valid JSON. No markdown, no explanation.`;

export function buildPrdExtractionPrompt(prdText: string, graphContext: string | null = null): string {
  const graphSection = graphContext
    ? `\n\n## Codebase Symbol Graph\n${graphContext}`
    : "";
  return `Extract technical requirements from this PRD:${graphSection}\n\n## PRD Text\n${prdText}`;
}

export interface PrdEntities {
  entities: string[];
  apiEndpoints: string[];
  userFlows: string[];
  techRequirements: string[];
  integrations: string[];
}
