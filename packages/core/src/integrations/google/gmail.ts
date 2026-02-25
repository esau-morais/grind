import type { GoogleServiceConfig } from "../../grind-home";
import { googleFetch } from "./client";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  body?: string;
}

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{ mimeType: string; body?: { data?: string } }>;
  };
}

interface HistoryRecord {
  messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
}

interface HistoryResponse {
  history?: HistoryRecord[];
  historyId: string;
  nextPageToken?: string;
}

export interface GmailHistoryResult {
  messages: Array<{ id: string; threadId: string }>;
  historyId: string;
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decodeBase64Url(encoded: string): string {
  const safe = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(safe, "base64").toString("utf-8");
}

function extractBody(msg: RawMessage): string | undefined {
  const payload = msg.payload;
  if (!payload) return undefined;
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  const textPart = payload.parts?.find((p) => p.mimeType === "text/plain");
  if (textPart?.body?.data) return decodeBase64Url(textPart.body.data);
  return undefined;
}

export async function getGmailProfile(
  serviceConfig: GoogleServiceConfig,
): Promise<{ historyId: string; emailAddress: string }> {
  const resp = await googleFetch(`${BASE}/profile`, serviceConfig);
  return resp.json() as Promise<{ historyId: string; emailAddress: string }>;
}

export async function getGmailHistory(
  serviceConfig: GoogleServiceConfig,
  startHistoryId: string,
): Promise<GmailHistoryResult> {
  const url = new URL(`${BASE}/history`);
  url.searchParams.set("startHistoryId", startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");

  const resp = await googleFetch(url.toString(), serviceConfig);
  const data = (await resp.json()) as HistoryResponse;

  const messages: Array<{ id: string; threadId: string }> = [];
  for (const record of data.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      messages.push(added.message);
    }
  }

  return { messages, historyId: data.historyId };
}

export async function listMessages(
  serviceConfig: GoogleServiceConfig,
  params: { q?: string; maxResults?: number },
): Promise<Array<{ id: string; threadId: string }>> {
  const url = new URL(`${BASE}/messages`);
  if (params.q) url.searchParams.set("q", params.q);
  url.searchParams.set("maxResults", String(params.maxResults ?? 20));

  const resp = await googleFetch(url.toString(), serviceConfig);
  const data = (await resp.json()) as { messages?: Array<{ id: string; threadId: string }> };
  return data.messages ?? [];
}

export async function getMessage(
  serviceConfig: GoogleServiceConfig,
  messageId: string,
  includeBody = false,
): Promise<GmailMessageSummary> {
  const url = new URL(`${BASE}/messages/${messageId}`);
  url.searchParams.set("format", includeBody ? "full" : "metadata");
  if (!includeBody) {
    url.searchParams.append("metadataHeaders", "From");
    url.searchParams.append("metadataHeaders", "To");
    url.searchParams.append("metadataHeaders", "Subject");
    url.searchParams.append("metadataHeaders", "Date");
  }

  const resp = await googleFetch(url.toString(), serviceConfig);
  const msg = (await resp.json()) as RawMessage;
  const headers = msg.payload?.headers ?? [];

  const summary: GmailMessageSummary = {
    id: msg.id,
    threadId: msg.threadId,
    from: extractHeader(headers, "From"),
    to: extractHeader(headers, "To"),
    subject: extractHeader(headers, "Subject"),
    snippet: msg.snippet ?? "",
    date: extractHeader(headers, "Date"),
  };

  if (includeBody) {
    const body = extractBody(msg);
    if (body) summary.body = body;
  }

  return summary;
}

export async function sendEmail(
  serviceConfig: GoogleServiceConfig,
  params: { to: string; subject: string; body: string; cc?: string },
): Promise<{ id: string; threadId: string }> {
  const headerLines = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
  ].join("\r\n");

  const raw = Buffer.from(`${headerLines}\r\n\r\n${params.body}`).toString("base64url");

  const resp = await googleFetch(`${BASE}/messages/send`, serviceConfig, {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return resp.json() as Promise<{ id: string; threadId: string }>;
}
