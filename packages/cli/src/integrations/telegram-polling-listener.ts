interface TelegramPollingListenerOptions {
  botToken: string;
  gatewayUrl: string;
  gatewayToken: string;
  telegramWebhookSecret?: string;
  onInfo?: (message: string) => void;
  onWarn?: (message: string) => void;
}

export interface TelegramPollingListener {
  stop: () => Promise<void>;
}

const POLL_TIMEOUT_SECONDS = 25;

export function startTelegramPollingListener(
  options: TelegramPollingListenerOptions,
): TelegramPollingListener {
  const controller = new AbortController();
  const signal = controller.signal;

  void runPollingLoop(options, signal);

  return {
    stop: async () => {
      controller.abort();
      await sleep(100);
    },
  };
}

async function runPollingLoop(
  options: TelegramPollingListenerOptions,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0;
  let warnedConflict = false;

  while (!signal.aborted) {
    try {
      const url = new URL(`https://api.telegram.org/bot${options.botToken}/getUpdates`);
      url.searchParams.set("timeout", String(POLL_TIMEOUT_SECONDS));
      url.searchParams.set(
        "allowed_updates",
        JSON.stringify([
          "message",
          "edited_message",
          "channel_post",
          "edited_channel_post",
          "callback_query",
        ]),
      );
      if (offset > 0) {
        url.searchParams.set("offset", String(offset));
      }

      const response = await fetch(url, {
        method: "GET",
        signal,
      });

      if (response.status === 409) {
        if (!warnedConflict) {
          options.onWarn?.(
            "Telegram polling disabled: webhook is active on Telegram (409 conflict).",
          );
          warnedConflict = true;
        }
        await sleep(5000);
        continue;
      }

      warnedConflict = false;

      if (!response.ok) {
        const body = await response.text();
        options.onWarn?.(`Telegram polling error (${response.status}): ${body}`);
        await sleep(3000);
        continue;
      }

      const parsed = (await response.json()) as {
        ok?: boolean;
        result?: Array<{ update_id?: number } & Record<string, unknown>>;
      };

      if (!parsed.ok || !Array.isArray(parsed.result)) {
        await sleep(1000);
        continue;
      }

      for (const update of parsed.result) {
        const updateId = typeof update.update_id === "number" ? update.update_id : null;
        if (updateId !== null) {
          offset = updateId + 1;
        }

        await forwardUpdate(options, update, signal);
      }
    } catch (error) {
      if (signal.aborted) break;
      options.onWarn?.(
        `Telegram polling loop error: ${error instanceof Error ? error.message : String(error)}`,
      );
      await sleep(2000);
    }
  }

  options.onInfo?.("Telegram polling listener stopped.");
}

async function forwardUpdate(
  options: TelegramPollingListenerOptions,
  update: Record<string, unknown>,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (options.telegramWebhookSecret) {
    headers["x-telegram-bot-api-secret-token"] = options.telegramWebhookSecret;
  } else {
    headers.authorization = `Bearer ${options.gatewayToken}`;
  }

  const response = await fetch(`${options.gatewayUrl}/hooks/telegram`, {
    method: "POST",
    headers,
    body: JSON.stringify(update),
    signal,
  });

  if (!response.ok) {
    const body = await response.text();
    options.onWarn?.(`Failed forwarding Telegram update (${response.status}): ${body}`);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
