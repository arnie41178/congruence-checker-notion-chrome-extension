const CLIENT_ID_KEY = "alucify_client_id";

export async function getOrCreateClientId(): Promise<string> {
  const result = await chrome.storage.local.get(CLIENT_ID_KEY);
  if (result[CLIENT_ID_KEY]) {
    return result[CLIENT_ID_KEY] as string;
  }
  const newId = crypto.randomUUID();
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: newId });
  return newId;
}
