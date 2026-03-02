const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const DISCORD_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);

interface DiscordGatewayListenerOptions {
  botToken: string;
  gatewayUrl: string;
  gatewayToken: string;
  onInfo?: (message: string) => void;
  onWarn?: (message: string) => void;
}

export interface DiscordGatewayListener {
  stop: () => Promise<void>;
}

export function startDiscordGatewayListener(
  options: DiscordGatewayListenerOptions,
): DiscordGatewayListener {
  let stopped = false;
  let ws: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let lastSequence: number | null = null;
  let sessionId: string | null = null;
  let resumeUrl: string | null = null;
  let botUserId: string | null = null;

  const connect = (url: string) => {
    if (stopped) return;

    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      options.onInfo?.("Discord gateway connected.");
    });

    ws.addEventListener("message", (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      const op = data.op as number;
      const t = data.t as string | null;
      const d = data.d as Record<string, unknown> | null;
      const s = data.s as number | null;

      if (s !== null) lastSequence = s;

      if (op === 10) {
        const interval = (d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41250;
        startHeartbeat(interval);
        sendIdentify();
        return;
      }

      if (op === 11) return; // heartbeat ACK

      if (op === 7) {
        // reconnect requested
        ws?.close();
        reconnect();
        return;
      }

      if (op === 9) {
        // invalid session
        sessionId = null;
        setTimeout(
          () => {
            if (!stopped) connect(DISCORD_GATEWAY_URL);
          },
          2000 + Math.random() * 3000,
        );
        return;
      }

      if (op === 0 && t === "READY" && d) {
        sessionId = typeof d.session_id === "string" ? d.session_id : null;
        resumeUrl = typeof d.resume_gateway_url === "string" ? d.resume_gateway_url : null;
        const user = d.user as { id?: string } | undefined;
        botUserId = user?.id ?? null;
        options.onInfo?.("Discord gateway READY.");
        return;
      }

      if (op === 0 && t === "MESSAGE_CREATE" && d) {
        void handleMessage(d);
      }
    });

    ws.addEventListener("close", () => {
      stopHeartbeat();
      if (!stopped) {
        options.onWarn?.("Discord gateway closed. Reconnecting...");
        setTimeout(() => reconnect(), 3000);
      }
    });

    ws.addEventListener("error", (err) => {
      options.onWarn?.(`Discord gateway error: ${err}`);
    });
  };

  const reconnect = () => {
    if (stopped) return;
    if (sessionId && resumeUrl) {
      connect(`${resumeUrl}/?v=10&encoding=json`);
    } else {
      connect(DISCORD_GATEWAY_URL);
    }
  };

  const startHeartbeat = (intervalMs: number) => {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      ws?.send(JSON.stringify({ op: 1, d: lastSequence }));
    }, intervalMs);
    // send first heartbeat with jitter
    setTimeout(() => {
      ws?.send(JSON.stringify({ op: 1, d: lastSequence }));
    }, Math.random() * intervalMs);
  };

  const stopHeartbeat = () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  };

  const sendIdentify = () => {
    if (sessionId) {
      ws?.send(
        JSON.stringify({
          op: 6,
          d: { token: options.botToken, session_id: sessionId, seq: lastSequence },
        }),
      );
    } else {
      ws?.send(
        JSON.stringify({
          op: 2,
          d: {
            token: options.botToken,
            intents: DISCORD_INTENTS,
            properties: { os: "linux", browser: "grind", device: "grind" },
          },
        }),
      );
    }
  };

  const handleMessage = async (d: Record<string, unknown>) => {
    const authorId = (d.author as { id?: string; bot?: boolean })?.id;
    const authorBot = (d.author as { bot?: boolean })?.bot;

    if (authorBot || authorId === botUserId) return;

    const channelId = typeof d.channel_id === "string" ? d.channel_id : null;
    const messageId = typeof d.id === "string" ? d.id : null;
    const text = typeof d.content === "string" ? d.content : "";
    if (!channelId || !messageId) return;

    let inboundMedia: { url: string; mime: string } | undefined;
    const attachments = d.attachments as
      | Array<{
          url?: string;
          filename?: string;
          content_type?: string;
          size?: number;
        }>
      | undefined;
    if (attachments?.length) {
      const first = attachments[0];
      if (first?.url && (first.size ?? 0) <= 5 * 1024 * 1024) {
        const mime = resolveAttachmentMime(first.content_type, first.filename);
        if (mime) inboundMedia = { url: first.url, mime };
      }
    }

    if (!text && !inboundMedia) return;

    const eventPayload = {
      channel: "discord",
      eventName: "message.received",
      messageId,
      chatId: channelId,
      senderId: authorId ?? null,
      ...(text ? { text } : {}),
      ...(inboundMedia ? { inboundMedia } : {}),
    };

    const body = {
      type: "context",
      confidence: 0.95,
      detectedAt: Date.now(),
      dedupeKey: `discord:${messageId}`,
      payload: eventPayload,
      eventPayload,
    };

    try {
      const response = await fetch(`${options.gatewayUrl}/hooks/inbound`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.gatewayToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        options.onWarn?.(`Failed forwarding Discord event (${response.status}).`);
      }
    } catch (error) {
      options.onWarn?.(
        `Failed forwarding Discord event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  connect(DISCORD_GATEWAY_URL);

  return {
    stop: async () => {
      stopped = true;
      stopHeartbeat();
      ws?.close();
    },
  };
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

function resolveAttachmentMime(
  contentType: string | undefined,
  filename: string | undefined,
): string | null {
  if (contentType?.startsWith("image/")) return contentType;
  if (filename) {
    const ext = filename.split(".").pop()?.toLowerCase();
    if (ext && IMAGE_EXTENSIONS[ext]) return IMAGE_EXTENSIONS[ext];
  }
  return null;
}
