import type { FastifyInstance } from "fastify";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/notion/token", async (request, reply) => {
    const { code, redirectUri } = request.body as { code: string; redirectUri: string };
    if (!code || !redirectUri) return reply.code(400).send({ error: "bad_request" });

    const clientId = process.env.NOTION_CLIENT_ID!;
    const clientSecret = process.env.NOTION_CLIENT_SECRET!;
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await fetch("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });

    if (!res.ok) {
      const err = await res.text();
      return reply.code(401).send({ error: "auth_failed", message: err });
    }

    const data = await res.json() as { access_token: string; workspace_name: string };
    return reply.send({ access_token: data.access_token, workspace_name: data.workspace_name });
  });
}
