import type { InboundMedia } from "@grindxp/core";

export type PermissionReply = "once" | "always" | "deny";

export interface ChannelAdapter {
  readonly channel: string;

  sendText(chatId: string, text: string): Promise<void>;

  sendPermissionPrompt(opts: {
    chatId: string;
    permissionId: string;
    text: string;
  }): Promise<string | undefined>;

  answerPermissionCallback(opts: { callbackId: string; text: string }): Promise<void>;

  editPermissionMessage(opts: { chatId: string; messageId: string; text: string }): Promise<void>;

  fetchAttachment(media: InboundMedia): Promise<{ mime: string; base64: string } | null>;

  formatReply(markdown: string): { text: string; chunks: string[] };

  sendToolOutput?(chatId: string, block: ToolOutputBlock): Promise<void>;
}

export interface ToolOutputBlock {
  title: string;
  content: string;
  language?: string;
}
