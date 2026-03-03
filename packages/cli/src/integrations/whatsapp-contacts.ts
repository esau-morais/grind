import { readContacts, type StoredContact, writeContacts } from "@grindxp/core";
import type { BaileysEventEmitter, Contact } from "@whiskeysockets/baileys";

type LIDMapping = { lid: string; pn: string };

export interface ContactCollector {
  /** Pending contact upserts, keyed by their provisional JID */
  readonly pending: Map<string, StoredContact>;
  /** LID → PN JID mappings gathered from history sync and app-state sync */
  readonly lidMap: Map<string, string>;
  /**
   * Merge pending contacts into contacts.json.
   * - Resolves @lid JIDs to @s.whatsapp.net via lidMap
   * - Deduplicates entries that share an LID mapping
   * - Filters out @g.us group JIDs
   * - For contacts.update-sourced entries (notify-only), only patches notify
   *   on existing records — never creates new entries
   */
  flush: () => void;
}

/**
 * Creates a ContactCollector bound to the given socket's event emitter.
 * Register before waitForConnection — messaging-history.set can fire during
 * the handshake, before the connection is fully open.
 */
export function createContactCollector(socket: BaileysEventEmitter): ContactCollector {
  const pending = new Map<string, StoredContact>();
  // notifyOnly tracks JIDs that arrived exclusively via contacts.update
  // (push-name-only events from incoming messages). We only patch notify on
  // existing records for these; we never create new entries.
  const notifyOnly = new Set<string>();
  const lidMap = new Map<string, string>();

  function applyLidMappings(pairs: LIDMapping[]): void {
    for (const { lid, pn } of pairs) {
      if (!lid || !pn) continue;
      lidMap.set(lid, pn);
    }
  }

  function upsertContacts(contacts: Partial<Contact>[]): void {
    for (const c of contacts) {
      if (!c.id) continue;

      // Normalise the primary JID — prefer phoneNumber over id when available.
      const rawId = (c.phoneNumber ?? c.id).trim();
      if (!rawId) continue;

      // Skip groups.
      if (rawId.includes("@g.us")) continue;

      const jid = rawId.includes("@") ? rawId : `${rawId}@s.whatsapp.net`;
      if (jid.includes("@g.us")) continue;

      const lidJid = c.lid ?? (c.id.includes("@lid") ? c.id : undefined);

      const name = c.name ?? undefined;
      const notify = c.notify ?? undefined;

      // If we only have a push name (notify) and no phone-book name, this
      // arrived via contacts.update from a message receipt. Only update notify
      // on already-known contacts; never create a new entry.
      if (!name && notify && !pending.has(jid)) {
        notifyOnly.add(jid);
        // Store a minimal record so flush() can patch existing contacts.json.
        pending.set(jid, {
          name: notify,
          whatsappId: jid,
          notify,
          ...(lidJid ? { lid: lidJid } : {}),
        });
        return;
      }

      // We have a real name. If this JID was previously queued as notify-only,
      // promote it to a full entry.
      notifyOnly.delete(jid);

      const displayName = name ?? notify;
      if (!displayName) continue;

      const existing = pending.get(jid);
      const merged: StoredContact = {
        name: name ?? existing?.name ?? displayName,
        whatsappId: jid,
        ...(notify ? { notify } : existing?.notify ? { notify: existing.notify } : {}),
        ...(lidJid ? { lid: lidJid } : existing?.lid ? { lid: existing.lid } : {}),
      };

      pending.set(jid, merged);

      // If we learned a LID from this contact, record the mapping.
      if (lidJid) {
        lidMap.set(lidJid, jid);
      }
    }
  }

  // contacts.upsert — full Contact objects from app-state sync or history sync.
  socket.on("contacts.upsert", upsertContacts);

  // contacts.update — partial updates, typically only carry notify from message receipts.
  socket.on("contacts.update", upsertContacts);

  // messaging-history.set — history sync payload with contacts[].
  // LID-PN mappings come via lid-mapping.update (fired per-pair by Baileys).
  socket.on("messaging-history.set", (e) => {
    if (e.contacts?.length) upsertContacts(e.contacts);
  });

  // lid-mapping.update — emitted from app-state sync (contactAction / pnForLidChatAction).
  socket.on("lid-mapping.update", ({ lid, pn }) => applyLidMappings([{ lid, pn }]));

  return {
    pending,
    lidMap,
    flush,
  };

  function flush(): void {
    if (pending.size === 0) return;

    // Resolve @lid-keyed pending entries to @s.whatsapp.net where possible.
    const resolved = new Map<string, StoredContact>();

    for (const [key, contact] of pending) {
      if (key.includes("@lid")) {
        const pn = lidMap.get(key);
        if (pn) {
          // Promote to PN-keyed entry, keep lid as cross-ref.
          const promoted: StoredContact = { ...contact, whatsappId: pn, lid: key };
          const existing = resolved.get(pn);
          resolved.set(pn, mergeContacts(existing, promoted));
        } else {
          // No mapping yet — keep as @lid.
          const existing = resolved.get(key);
          resolved.set(key, mergeContacts(existing, contact));
        }
      } else {
        // Also record the PN in lidMap if contact carries a lid (bidirectional).
        if (contact.lid) lidMap.set(contact.lid, key);
        const existing = resolved.get(key);
        resolved.set(key, mergeContacts(existing, contact));
      }
    }

    // Load existing contacts.json.
    const stored = readContacts();

    // Build a lookup by whatsappId and by lid for deduplication.
    const byId = new Map<string, StoredContact>(stored.map((c) => [c.whatsappId, c]));
    const byLid = new Map<string, string>(); // lid → whatsappId
    for (const c of stored) {
      if (c.lid) byLid.set(c.lid, c.whatsappId);
    }

    for (const [jid, contact] of resolved) {
      if (jid.includes("@g.us")) continue;

      if (notifyOnly.has(jid)) {
        // Only patch notify on an existing entry; never insert a new one.
        const existing = byId.get(jid);
        if (existing && contact.notify) {
          byId.set(jid, { ...existing, notify: contact.notify });
        }
        // Also try to find via lid cross-reference.
        if (!existing && contact.lid) {
          const canonId = byLid.get(contact.lid);
          if (canonId) {
            const canon = byId.get(canonId);
            if (canon && contact.notify) byId.set(canonId, { ...canon, notify: contact.notify });
          }
        }
        continue;
      }

      // Full upsert. Check if there is already an entry that matches via lid.
      const existingByLid = contact.lid ? byLid.get(contact.lid) : undefined;
      if (existingByLid && existingByLid !== jid) {
        // Merge into the canonical PN entry, remove old @lid entry.
        const canon = byId.get(existingByLid)!;
        byId.set(existingByLid, mergeContacts(canon, contact));
        byId.delete(jid); // remove the @lid duplicate if it was stored separately
      } else {
        const prev = byId.get(jid);
        byId.set(jid, mergeContacts(prev, contact));
      }

      // Update byLid index for any new lid we now know.
      if (contact.lid) byLid.set(contact.lid, jid);
    }

    const result = [...byId.values()].filter((c) => !c.whatsappId.includes("@g.us"));
    writeContacts(result);
    const full = result.filter((c) => !c.whatsappId.includes("@lid")).length;
    const lids = result.filter((c) => c.whatsappId.includes("@lid")).length;
    process.stdout.write(
      `Synced ${result.length} contacts (${full} with phone number, ${lids} unresolved @lid).\n`,
    );
  }
}

/** Merge two StoredContact records — prev fields are kept unless overridden by next. */
function mergeContacts(prev: StoredContact | undefined, next: StoredContact): StoredContact {
  if (!prev) return next;
  return {
    // Prefer a real phone-book name over a push name.
    name: next.name && next.name !== next.notify ? next.name : (prev.name ?? next.name),
    whatsappId: next.whatsappId,
    ...((next.notify ?? prev.notify) ? { notify: next.notify ?? prev.notify } : {}),
    ...((next.lid ?? prev.lid) ? { lid: next.lid ?? prev.lid } : {}),
  };
}
