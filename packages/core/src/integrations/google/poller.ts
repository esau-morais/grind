import type { GoogleServiceConfig } from "../../grind-home";
import { runForgeTick } from "../../forge";
import { recordSignal } from "../../vault/repositories";
import type { VaultDb } from "../../vault/types";
import { listCalendarEvents } from "./calendar";
import { GoogleApiError } from "./client";
import { getGmailHistory, getGmailProfile, getMessage } from "./gmail";
import { getGoogleSyncState, saveGoogleSyncState } from "./service-state";

const DEFAULT_POLL_INTERVAL_SECONDS = 300;

export interface GooglePollerOptions {
  db: VaultDb;
  userId: string;
  serviceConfig: GoogleServiceConfig;
}

export class GooglePoller {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(private readonly options: GooglePollerOptions) {}

  start(): void {
    const intervalMs =
      (this.options.serviceConfig.pollIntervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000;

    this.tick().catch((err: unknown) => {
      console.error("[google-poller] Initial tick failed:", err);
    });

    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.tick().catch((err: unknown) => {
        console.error("[google-poller] Tick failed:", err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    this.ticking = true;
    try {
      const { serviceConfig } = this.options;
      if (serviceConfig.calendarEnabled) {
        await this.syncCalendar();
      }
      if (serviceConfig.gmailEnabled) {
        await this.syncGmail();
      }
    } finally {
      this.ticking = false;
    }
  }

  private async syncCalendar(): Promise<void> {
    const { serviceConfig, db, userId } = this.options;
    const state = getGoogleSyncState();

    try {
      const result = await listCalendarEvents(serviceConfig, {
        ...(state.calendarSyncToken ? { syncToken: state.calendarSyncToken } : {}),
        showDeleted: true,
      });

      const isIncremental = Boolean(state.calendarSyncToken);

      for (const event of result.events) {
        const forgeEventType =
          event.status === "cancelled" ? "event" : isIncremental ? "event" : "event";

        const calendarAction =
          event.status === "cancelled" ? "deleted" : isIncremental ? "updated" : "created";

        const signal = await recordSignal(db, {
          userId,
          source: "google-calendar",
          type: "schedule",
          confidence: 1,
          payload: {
            eventId: event.id,
            summary: event.summary ?? null,
            status: event.status,
            action: calendarAction,
            start: event.start,
            end: event.end,
            ...(event.location ? { location: event.location } : {}),
            ...(event.attendees ? { attendees: event.attendees } : {}),
            ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
          },
          detectedAt: Date.now(),
        });

        await runForgeTick({
          db,
          userId,
          includeCollectors: false,
          events: [
            {
              type: forgeEventType,
              payload: {
                source: "google-calendar",
                action: calendarAction,
                signalId: signal.id,
                event: {
                  id: event.id,
                  summary: event.summary,
                  status: event.status,
                  start: event.start,
                  end: event.end,
                },
              },
              at: Date.now(),
              dedupeKey: `google-calendar:${calendarAction}:${event.id}:${event.updated ?? Date.now()}`,
            },
          ],
        });
      }

      if (result.nextSyncToken) {
        saveGoogleSyncState({
          calendarSyncToken: result.nextSyncToken,
          calendarLastPollAt: Date.now(),
        });
      }
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 410) {
        saveGoogleSyncState({ calendarSyncToken: undefined, calendarLastPollAt: undefined });
        console.warn("[google-poller] Calendar sync token expired — full re-sync on next tick");
        return;
      }
      throw err;
    }
  }

  private async syncGmail(): Promise<void> {
    const { serviceConfig, db, userId } = this.options;
    const state = getGoogleSyncState();

    try {
      if (!state.gmailHistoryId) {
        const profile = await getGmailProfile(serviceConfig);
        saveGoogleSyncState({ gmailHistoryId: profile.historyId, gmailLastPollAt: Date.now() });
        return;
      }

      const history = await getGmailHistory(serviceConfig, state.gmailHistoryId);

      for (const { id } of history.messages) {
        const msg = await getMessage(serviceConfig, id, false);

        const signal = await recordSignal(db, {
          userId,
          source: "gmail",
          type: "activity",
          confidence: 1,
          payload: {
            messageId: msg.id,
            threadId: msg.threadId,
            from: msg.from,
            subject: msg.subject,
            snippet: msg.snippet,
            date: msg.date,
          },
          detectedAt: Date.now(),
        });

        await runForgeTick({
          db,
          userId,
          includeCollectors: false,
          events: [
            {
              type: "event",
              payload: {
                source: "gmail",
                action: "message.received",
                signalId: signal.id,
                from: msg.from,
                subject: msg.subject,
                snippet: msg.snippet,
              },
              at: Date.now(),
              dedupeKey: `gmail:message:${msg.id}`,
            },
          ],
        });
      }

      saveGoogleSyncState({
        gmailHistoryId: history.historyId,
        gmailLastPollAt: Date.now(),
      });
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) {
        saveGoogleSyncState({ gmailHistoryId: undefined, gmailLastPollAt: undefined });
        console.warn("[google-poller] Gmail history ID expired — will reset on next tick");
        return;
      }
      throw err;
    }
  }
}
