import { google, gmail_v1 } from "googleapis";
import { EmailMessage } from "../ingest/types";

/** OAuth2 Gmail client from a stored refresh token, or null if env is not configured. */
export function getGmailClient(): gmail_v1.Gmail | null {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth });
}

function header(raw: gmail_v1.Schema$Message, name: string): string {
  const h = raw.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function domainOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  const addr = (m ? m[1] : from).trim();
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : "";
}

/** Depth-first search for the first text/plain part; falls back to text/html or the top-level body. */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const decode = (data?: string | null) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

  const findPart = (part: gmail_v1.Schema$MessagePart, mime: string): string | null => {
    if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const found = findPart(child, mime);
      if (found) return found;
    }
    return null;
  };

  const plain = findPart(payload, "text/plain");
  if (plain) return plain;
  const html = findPart(payload, "text/html");
  if (html) return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decode(payload.body?.data);
}

export function parseMessage(raw: gmail_v1.Schema$Message): EmailMessage {
  const from = header(raw, "From");
  return {
    id: raw.id ?? "",
    from,
    fromDomain: domainOf(from),
    subject: header(raw, "Subject"),
    snippet: raw.snippet ?? "",
    body: extractBody(raw.payload),
    receivedAt: new Date(Number(raw.internalDate ?? 0)),
  };
}

/**
 * Returns new messages since the given historyId. Falls back to a 7-day query
 * when the cursor is missing or expired (Gmail drops history cursors after ~1 week).
 * newHistoryId is the mailbox's current historyId, to persist only after success.
 */
export async function fetchNewMessages(
  gmail: gmail_v1.Gmail,
  sinceHistoryId: string | null
): Promise<{ messages: EmailMessage[]; newHistoryId: string | null }> {
  const profile = await gmail.users.getProfile({ userId: "me" });
  const currentHistoryId = profile.data.historyId ?? null;

  let messageIds: string[] = [];
  let usedFallback = !sinceHistoryId;

  if (sinceHistoryId) {
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;
      do {
        const hist = await gmail.users.history.list({
          userId: "me", startHistoryId: sinceHistoryId, historyTypes: ["messageAdded"], pageToken,
        });
        for (const h of hist.data.history ?? [])
          for (const m of h.messagesAdded ?? [])
            if (m.message?.id) ids.add(m.message.id);
        pageToken = hist.data.nextPageToken ?? undefined;
      } while (pageToken);
      messageIds = [...ids];
    } catch (err: unknown) {
      const status =
        (err as { response?: { status?: number } })?.response?.status ??
        (err as { code?: number })?.code;
      if (status === 404) {
        console.warn("[gmail] history cursor expired — falling back to 7-day scan");
        usedFallback = true; // expired cursor: Gmail drops history after ~1 week
      } else {
        throw err; // network/429/auth errors must surface, not be masked as a rescan
      }
    }
  }

  if (usedFallback) {
    const list = await gmail.users.messages.list({ userId: "me", q: "newer_than:7d", maxResults: 100 });
    messageIds = (list.data.messages ?? []).filter((m): m is { id: string } => !!m.id).map((m) => m.id);
  }

  const messages: EmailMessage[] = [];
  for (const id of messageIds) {
    const full = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    messages.push(parseMessage(full.data));
  }

  return { messages, newHistoryId: currentHistoryId };
}
