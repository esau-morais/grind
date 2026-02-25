import { z } from "zod";

import { signalTypeSchema } from "../schema";
import type { CreateSignalInput } from "../schema";
import type { ForgeEvent } from "../forge";

export interface NormalizedGatewayEvent {
  signal: CreateSignalInput;
  forgeEvent: ForgeEvent;
}

interface WhatsAppNormalizeOptions {
  source: "message" | "status";
}

const inboundWebhookSchema = z
  .object({
    type: signalTypeSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    detectedAt: z.number().int().nonnegative().optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
    dedupeKey: z.string().min(1).max(512).optional(),
    eventPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    date: z.number().int().optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    chat: z.object({ id: z.union([z.number(), z.string()]) }).optional(),
    from: z.object({ id: z.union([z.number(), z.string()]) }).optional(),
  })
  .passthrough();

const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().optional(),
    message: telegramMessageSchema.optional(),
    edited_message: telegramMessageSchema.optional(),
    channel_post: telegramMessageSchema.optional(),
    edited_channel_post: telegramMessageSchema.optional(),
    callback_query: z
      .object({
        id: z.string().optional(),
        data: z.string().optional(),
        from: z.object({ id: z.union([z.number(), z.string()]) }).optional(),
        message: telegramMessageSchema.optional(),
      })
      .optional(),
  })
  .passthrough();

const discordInteractionSchema = z
  .object({
    id: z.string().optional(),
    type: z.number().int(),
    token: z.string().optional(),
    application_id: z.string().optional(),
    guild_id: z.string().optional(),
    channel_id: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    member: z
      .object({
        user: z
          .object({
            id: z.string().optional(),
            username: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
    user: z
      .object({
        id: z.string().optional(),
        username: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const whatsAppStatusSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    timestamp: z.string().optional(),
    recipient_id: z.string().optional(),
    conversation: z
      .object({
        id: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

const whatsAppMessageSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string().optional(),
    text: z
      .object({
        body: z.string().optional(),
      })
      .optional(),
    image: z.record(z.string(), z.unknown()).optional(),
    audio: z.record(z.string(), z.unknown()).optional(),
    video: z.record(z.string(), z.unknown()).optional(),
    document: z.record(z.string(), z.unknown()).optional(),
    interactive: z.record(z.string(), z.unknown()).optional(),
    button: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const whatsAppWebhookSchema = z
  .object({
    object: z.string().optional(),
    entry: z
      .array(
        z
          .object({
            id: z.string().optional(),
            changes: z.array(
              z
                .object({
                  field: z.string().optional(),
                  value: z
                    .object({
                      metadata: z
                        .object({
                          phone_number_id: z.string().optional(),
                          display_phone_number: z.string().optional(),
                        })
                        .optional(),
                      contacts: z
                        .array(
                          z
                            .object({
                              wa_id: z.string().optional(),
                              profile: z.object({ name: z.string().optional() }).optional(),
                            })
                            .passthrough(),
                        )
                        .optional(),
                      messages: z.array(whatsAppMessageSchema).optional(),
                      statuses: z.array(whatsAppStatusSchema).optional(),
                    })
                    .passthrough(),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export function normalizeInboundWebhook(
  input: unknown,
  userId: string,
  now = Date.now(),
): NormalizedGatewayEvent {
  const parsed = inboundWebhookSchema.parse(input);
  const detectedAt = parsed.detectedAt ?? now;
  const payload = {
    channel: "webhook",
    eventName: "external.inbound",
    ...parsed.payload,
  };

  return {
    signal: {
      userId,
      source: "webhook",
      type: parsed.type ?? "context",
      confidence: parsed.confidence ?? 0.8,
      payload,
      detectedAt,
    },
    forgeEvent: {
      type: "webhook",
      payload: parsed.eventPayload ?? payload,
      at: detectedAt,
      ...(parsed.dedupeKey ? { dedupeKey: parsed.dedupeKey } : {}),
    },
  };
}

export function normalizeTelegramWebhookUpdate(
  input: unknown,
  userId: string,
  now = Date.now(),
): NormalizedGatewayEvent {
  const update = telegramUpdateSchema.parse(input);
  const message =
    update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  const callbackQuery = update.callback_query;

  if (callbackQuery) {
    const callbackData = callbackQuery.data ?? "";
    const detectedAt = callbackQuery.message?.date ? callbackQuery.message.date * 1000 : now;
    const chatId =
      callbackQuery.message?.chat?.id !== undefined ? String(callbackQuery.message.chat.id) : null;
    const senderId = callbackQuery.from?.id !== undefined ? String(callbackQuery.from.id) : null;
    const updateId = update.update_id;
    const callbackQueryId = callbackQuery.id;

    const payload = {
      channel: "telegram",
      eventName: "callback.received",
      ...(updateId !== undefined ? { updateId } : {}),
      ...(callbackQueryId ? { callbackQueryId } : {}),
      ...(chatId ? { chatId } : {}),
      ...(senderId ? { senderId } : {}),
      ...(callbackData ? { callbackData } : {}),
    };

    return {
      signal: {
        userId,
        source: "webhook",
        type: "context",
        confidence: 0.95,
        payload,
        detectedAt,
      },
      forgeEvent: {
        type: "webhook",
        payload,
        at: detectedAt,
        ...(callbackQueryId ? { dedupeKey: `telegram-callback:${callbackQueryId}` } : {}),
      },
    };
  }

  const text = message?.text ?? message?.caption ?? "";
  const detectedAt = message?.date ? message.date * 1000 : now;
  const chatId = message?.chat?.id !== undefined ? String(message.chat.id) : null;
  const senderId = message?.from?.id !== undefined ? String(message.from.id) : null;
  const updateId = update.update_id;

  const payload = {
    channel: "telegram",
    eventName: "message.received",
    ...(updateId !== undefined ? { updateId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(senderId ? { senderId } : {}),
    ...(text ? { text } : {}),
  };

  return {
    signal: {
      userId,
      source: "webhook",
      type: "context",
      confidence: 0.95,
      payload,
      detectedAt,
    },
    forgeEvent: {
      type: "webhook",
      payload,
      at: detectedAt,
      ...(updateId !== undefined ? { dedupeKey: `telegram:${updateId}` } : {}),
    },
  };
}

export function normalizeDiscordInteraction(
  input: unknown,
  userId: string,
  now = Date.now(),
): NormalizedGatewayEvent {
  const interaction = discordInteractionSchema.parse(input);
  const interactionId = interaction.id;
  const actor = interaction.member?.user ?? interaction.user;
  const actorId = actor?.id ?? null;
  const actorName = actor?.username ?? null;

  const payload = {
    channel: "discord",
    eventName: "interaction.received",
    interactionType: interaction.type,
    ...(interactionId ? { interactionId } : {}),
    ...(interaction.application_id ? { applicationId: interaction.application_id } : {}),
    ...(interaction.guild_id ? { guildId: interaction.guild_id } : {}),
    ...(interaction.channel_id ? { channelId: interaction.channel_id } : {}),
    ...(actorId ? { actorId } : {}),
    ...(actorName ? { actorName } : {}),
    ...(interaction.data ? { data: interaction.data } : {}),
  };

  return {
    signal: {
      userId,
      source: "webhook",
      type: "context",
      confidence: 0.95,
      payload,
      detectedAt: now,
    },
    forgeEvent: {
      type: "webhook",
      payload,
      at: now,
      ...(interactionId ? { dedupeKey: `discord:${interactionId}` } : {}),
    },
  };
}

export function normalizeWhatsAppWebhook(
  input: unknown,
  userId: string,
  options: WhatsAppNormalizeOptions,
  now = Date.now(),
): NormalizedGatewayEvent[] {
  const payload = whatsAppWebhookSchema.parse(input);
  const events: NormalizedGatewayEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes) {
      if (change.field !== "messages") continue;
      const value = change.value;

      if (options.source === "message") {
        for (const message of value.messages ?? []) {
          const detectedAt = parseUnixSecondsMs(message.timestamp) ?? now;
          const from = message.from ?? null;
          const text = message.text?.body ?? null;
          const messageId = message.id;
          const messageType = message.type ?? "unknown";
          const contact = value.contacts?.find((contactValue) => contactValue.wa_id === from);

          const normalizedPayload = {
            channel: "whatsapp",
            eventName: "message.received",
            messageType,
            ...(messageId ? { messageId } : {}),
            ...(from ? { from } : {}),
            ...(text ? { text } : {}),
            ...(contact?.profile?.name ? { contactName: contact.profile.name } : {}),
            ...(value.metadata?.phone_number_id
              ? { phoneNumberId: value.metadata.phone_number_id }
              : {}),
          };

          events.push({
            signal: {
              userId,
              source: "webhook",
              type: "context",
              confidence: 0.95,
              payload: normalizedPayload,
              detectedAt,
            },
            forgeEvent: {
              type: "webhook",
              payload: normalizedPayload,
              at: detectedAt,
              ...(messageId ? { dedupeKey: `whatsapp:${messageId}` } : {}),
            },
          });
        }
      }

      if (options.source === "status") {
        for (const status of value.statuses ?? []) {
          const detectedAt = parseUnixSecondsMs(status.timestamp) ?? now;
          const statusId = status.id;
          const normalizedPayload = {
            channel: "whatsapp",
            eventName: "message.status",
            status: status.status ?? "unknown",
            ...(statusId ? { messageId: statusId } : {}),
            ...(status.recipient_id ? { recipientId: status.recipient_id } : {}),
            ...(status.conversation?.id ? { conversationId: status.conversation.id } : {}),
            ...(value.metadata?.phone_number_id
              ? { phoneNumberId: value.metadata.phone_number_id }
              : {}),
          };

          events.push({
            signal: {
              userId,
              source: "webhook",
              type: "health",
              confidence: 0.9,
              payload: normalizedPayload,
              detectedAt,
            },
            forgeEvent: {
              type: "webhook",
              payload: normalizedPayload,
              at: detectedAt,
              ...(statusId
                ? { dedupeKey: `whatsapp-status:${statusId}:${status.status ?? "unknown"}` }
                : {}),
            },
          });
        }
      }
    }
  }

  return events;
}

function parseUnixSecondsMs(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds * 1000;
}
