import type { GoogleServiceConfig } from "../../grind-home";
import { googleFetch } from "./client";

const BASE = "https://www.googleapis.com/calendar/v3";

export interface CalendarEventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  status: "confirmed" | "tentative" | "cancelled";
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: CalendarAttendee[];
  htmlLink?: string;
  created?: string;
  updated?: string;
  organizer?: { email: string; displayName?: string };
  recurringEventId?: string;
  recurrence?: string[];
}

export interface CalendarItem {
  id: string;
  summary: string;
  primary?: boolean;
  timeZone?: string;
  selected?: boolean;
  hidden?: boolean;
  accessRole?: string;
}

export interface ListEventsResult {
  events: CalendarEvent[];
  nextSyncToken?: string;
  nextPageToken?: string;
}

export interface CreateEventInput {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  description?: string;
  location?: string;
  attendees?: string[];
  allDay?: boolean;
  timeZone?: string;
}

export async function listCalendarEvents(
  serviceConfig: GoogleServiceConfig,
  params: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    syncToken?: string;
    showDeleted?: boolean;
  },
): Promise<ListEventsResult> {
  const calendarId = encodeURIComponent(params.calendarId ?? "primary");
  const url = new URL(`${BASE}/calendars/${calendarId}/events`);

  if (params.syncToken) {
    url.searchParams.set("syncToken", params.syncToken);
    url.searchParams.set("showDeleted", "true");
  } else {
    if (params.timeMin) url.searchParams.set("timeMin", params.timeMin);
    if (params.timeMax) url.searchParams.set("timeMax", params.timeMax);
    if (params.showDeleted) url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
  }

  url.searchParams.set("maxResults", String(params.maxResults ?? 50));

  const resp = await googleFetch(url.toString(), serviceConfig);
  const data = (await resp.json()) as {
    items?: CalendarEvent[];
    nextSyncToken?: string;
    nextPageToken?: string;
  };

  return {
    events: data.items ?? [],
    ...(data.nextSyncToken ? { nextSyncToken: data.nextSyncToken } : {}),
    ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
  };
}

export async function getCalendarEvent(
  serviceConfig: GoogleServiceConfig,
  eventId: string,
  calendarId = "primary",
): Promise<CalendarEvent> {
  const calId = encodeURIComponent(calendarId);
  const resp = await googleFetch(`${BASE}/calendars/${calId}/events/${eventId}`, serviceConfig);
  return resp.json() as Promise<CalendarEvent>;
}

function buildEventBody(
  input: CreateEventInput | Partial<CreateEventInput>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.startDateTime !== undefined) {
    body.start = input.allDay
      ? { date: input.startDateTime.split("T")[0] }
      : { dateTime: input.startDateTime, ...(input.timeZone ? { timeZone: input.timeZone } : {}) };
  }
  if (input.endDateTime !== undefined) {
    body.end = input.allDay
      ? { date: input.endDateTime.split("T")[0] }
      : { dateTime: input.endDateTime, ...(input.timeZone ? { timeZone: input.timeZone } : {}) };
  }
  if (input.attendees?.length) {
    body.attendees = input.attendees.map((email) => ({ email }));
  }
  return body;
}

export async function createCalendarEvent(
  serviceConfig: GoogleServiceConfig,
  input: CreateEventInput,
  calendarId = "primary",
): Promise<CalendarEvent> {
  const calId = encodeURIComponent(calendarId);
  const resp = await googleFetch(`${BASE}/calendars/${calId}/events`, serviceConfig, {
    method: "POST",
    body: JSON.stringify(buildEventBody(input)),
  });
  return resp.json() as Promise<CalendarEvent>;
}

export async function updateCalendarEvent(
  serviceConfig: GoogleServiceConfig,
  eventId: string,
  patch: Partial<CreateEventInput>,
  calendarId = "primary",
): Promise<CalendarEvent> {
  const calId = encodeURIComponent(calendarId);
  const resp = await googleFetch(`${BASE}/calendars/${calId}/events/${eventId}`, serviceConfig, {
    method: "PATCH",
    body: JSON.stringify(buildEventBody(patch)),
  });
  return resp.json() as Promise<CalendarEvent>;
}

export async function deleteCalendarEvent(
  serviceConfig: GoogleServiceConfig,
  eventId: string,
  calendarId = "primary",
): Promise<void> {
  const calId = encodeURIComponent(calendarId);
  await googleFetch(`${BASE}/calendars/${calId}/events/${eventId}`, serviceConfig, {
    method: "DELETE",
  });
}

export async function listCalendars(serviceConfig: GoogleServiceConfig): Promise<CalendarItem[]> {
  const resp = await googleFetch(`${BASE}/users/me/calendarList`, serviceConfig);
  const data = (await resp.json()) as { items?: CalendarItem[] };
  return data.items ?? [];
}

export async function createCalendar(
  serviceConfig: GoogleServiceConfig,
  summary: string,
  timeZone?: string,
): Promise<CalendarItem> {
  const body: Record<string, unknown> = { summary };
  if (timeZone) body.timeZone = timeZone;
  const resp = await googleFetch(`${BASE}/calendars`, serviceConfig, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return resp.json() as Promise<CalendarItem>;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function getEventDateKey(event: CalendarEvent, tz: string): string {
  if (event.start.date) return event.start.date;
  if (!event.start.dateTime) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(event.start.dateTime));
}

function formatDateHeader(dateKey: string): string {
  const parts = dateKey.split("-");
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .replace(",", "");
}

function formatEventTime(dt: CalendarEventDateTime, tz: string): string {
  if (!dt.dateTime) return " All day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(dt.dateTime))
    .padStart(8);
}

function formatDuration(start: CalendarEventDateTime, end: CalendarEventDateTime): string {
  if (!start.dateTime || !end.dateTime) return "";
  const ms = new Date(end.dateTime).getTime() - new Date(start.dateTime).getTime();
  const totalMins = Math.round(ms / 60000);
  if (totalMins <= 0) return "";
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return ` · ${m}m`;
  if (m === 0) return ` · ${h}h`;
  return ` · ${h}h ${m}m`;
}

function truncateTitle(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "\u2026" : str;
}

export function formatCalendarEventsText(events: CalendarEvent[], timezone?: string): string {
  if (events.length === 0) return "No events in this period.";

  const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = getEventDateKey(event, tz);
    if (!key) continue;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  const sortedKeys = Array.from(groups.keys()).sort();
  const lines: string[] = [];

  for (const key of sortedKeys) {
    const dayEvents = groups.get(key)!;

    dayEvents.sort((a, b) => {
      const aAllDay = Boolean(a.start.date);
      const bAllDay = Boolean(b.start.date);
      if (aAllDay && !bAllDay) return -1;
      if (!aAllDay && bAllDay) return 1;
      if (a.start.dateTime && b.start.dateTime) {
        return new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime();
      }
      return 0;
    });

    if (lines.length > 0) lines.push("");
    lines.push(formatDateHeader(key));

    for (const event of dayEvents) {
      const isAllDay = Boolean(event.start.date);
      const time = isAllDay ? " All day" : formatEventTime(event.start, tz);
      const title = truncateTitle(event.summary ?? "(no title)", 48);
      const duration = isAllDay ? "" : formatDuration(event.start, event.end);
      lines.push(`  ${time}  ${title}${duration}`);
    }
  }

  return lines.join("\n");
}
