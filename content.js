// content.js — Final with merge-dedupe (email-priority + merge missing fields)
(async () => {
  // send logs to popup via background
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }
  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // regexes
  const PHONE_RE = /(\+?\d[\d\-\.\s\(\)]{6,}\d)/g;
  const EMAIL_RE = /([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g;

  // --- Normalizers & extractors ---
  function cleanPhone(raw) {
    if (!raw) return null;
    let p = String(raw).trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;
    p = p.replace(/[^+\d]/g, '');
    const digits = p.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return null;
    return p; // keep + if present
  }
  function phoneKey(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    // strip leading zeros for key consistency
    return digits.replace(/^0+/, '');
  }
  function extractFirstPhoneFromMessages(messages) {
    if (!messages || !messages.length) return null;
    for (const msg of messages) {
      const match = msg.match(PHONE_RE);
      if (match && match.length) {
        for (const raw of match) {
          const cp = cleanPhone(raw);
          if (cp) return cp;
        }
      }
    }
    return null;
  }

  function extractFirstEmailFromMessages(messages) {
    if (!messages || !messages.length) return null;
    for (const msg of messages) {
      const m = msg.match(EMAIL_RE);
      if (m && m.length) return m[0].trim();
    }
    return null;
  }

  function normalizeEmailForKey(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }

  function normalizeNameForKey(name) {
    if (!name) return null;
    return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeLinkedInUrl(url) {
    if (!url) return null;
    let u = String(url).trim();
    if (u.startsWith('//')) u = 'https:' + u;
    if (!u.startsWith('http')) {
      u = u.startsWith('/') ? 'https://www.linkedin.com' + u : 'https://www.linkedin.com/' + u;
    }
    try {
      const parsed = new URL(u);
      parsed.search = '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
      return parsed.toString().toLowerCase();
    } catch {
      return u.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
    }
  }

  function extractInternalIdFromHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, "https://linkedin.com");
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    } catch {}
    const m1 = href.match(/\/in\/([^\/?#]+)/);
    if (m1 && m1[1]) return m1[1];
    const m2 = href.match(/(ACo[A-Za-z0-9_-]+)/);
    if (m2 && m2[1]) return m2[1];
    return null;
  }
  function normalizeInternalIdForKey(id) {
    if (!id) return null;
    return String(id).trim().toLowerCase();
  }

  // --- Merge-Dedupe Engine (email-priority, merge missing fields) ---
  function mergeAndDedupe(rows) {
    // maps point to index in merged array
    const mapByEmail = new Map();
    const mapByInternal = new Map();
    const mapByLinkedIn = new Map();
    const mapByPhone = new Map();
    const mapByName = new Map();

    const merged = [];

    function registerMaps(item, idx) {
      const e = normalizeEmailForKey(item.email);
      const i = normalizeInternalIdForKey(item.linkedin_internal_id);
      const l = normalizeLinkedInUrl(item.linkedInUrl);
      const p = phoneKey(item.phone);
      const n = normalizeNameForKey(item.contactName);

      if (e) mapByEmail.set(e, idx);
      if (i) mapByInternal.set(i, idx);
      if (l) mapByLinkedIn.set(l, idx);
      if (p) mapByPhone.set(p, idx);
      if (n) mapByName.set(n, idx);
    }

    function findExistingIndex(item) {
      const e = normalizeEmailForKey(item.email);
      const i = normalizeInternalIdForKey(item.linkedin_internal_id);
      const l = normalizeLinkedInUrl(item.linkedInUrl);
      const p = phoneKey(item.phone);
      const n = normalizeNameForKey(item.contactName);

      if (e && mapByEmail.has(e)) return mapByEmail.get(e);
      if (i && mapByInternal.has(i)) return mapByInternal.get(i);
      if (l && mapByLinkedIn.has(l)) return mapByLinkedIn.get(l);
      if (p && mapByPhone.has(p)) return mapByPhone.get(p);
      if (n && mapByName.has(n)) return mapByName.get(n);
      return -1;
    }

    for (const row of rows) {
      const idx = findExistingIndex(row);
      if (idx === -1) {
        // no existing -> push new
        const copy = {
          contactName: row.contactName || '',
          linkedInUrl: row.linkedInUrl || '',
          linkedin_internal_id: row.linkedin_internal_id || '',
          phone: row.phone || null,
          email: row.email || null,
          messages: Array.isArray(row.messages) ? [...row.messages] : []
        };
        const newIdx = merged.push(copy) - 1;
        registerMaps(copy, newIdx);
      } else {
        // merge into existing
        const existing = merged[idx];

        // Decide which record should be "primary" by email presence.
        const existingHasEmail = existing.email && String(existing.email).trim() !== '';
        const incomingHasEmail = row.email && String(row.email).trim() !== '';

        // If incoming has email and existing doesn't, prefer incoming as base: but keep existing fields if incoming missing.
        if (incomingHasEmail && !existingHasEmail) {
          // make a merged object where email wins
          const mergedObj = {
            contactName: existing.contactName || row.contactName || '',
            linkedInUrl: existing.linkedInUrl || row.linkedInUrl || '',
            linkedin_internal_id: existing.linkedin_internal_id || row.linkedin_internal_id || '',
            phone: existing.phone || row.phone || null,
            email: row.email || existing.email || null,
            messages: Array.from(new Set([...(existing.messages || []), ...(row.messages || [])]))
          };
          merged[idx] = mergedObj;
          // re-register maps because keys may have changed (email added)
          registerMaps(merged[idx], idx);
        } else {
          // existing either has email or neither has email -> merge missing fields into existing
          existing.contactName = existing.contactName || row.contactName || '';
          existing.linkedInUrl = existing.linkedInUrl || row.linkedInUrl || '';
          existing.linkedin_internal_id = existing.linkedin_internal_id || row.linkedin_internal_id || '';
          existing.phone = existing.phone || row.phone || null;
          existing.email = existing.email || row.email || null;
          // merge messages (preserve order: existing then new unique)
          const set = new Set(existing.messages || []);
          for (const m of (row.messages || [])) set.add(m);
          existing.messages = Array.from(set);
          // update maps (in case keys new were added)
          registerMaps(existing, idx);
        }
      }
    }

    return merged;
  }

  // --- Main extraction ---
  try {
    sendUpdate("progress", "Loading conversations...");

    async function loadAllContacts() {
      const scrollContainer = document.querySelector('.msg-conversations-container__conversations-list');
      if (!scrollContainer) {
        sendUpdate("error", "Conversation list not found. Open LinkedIn Messaging.");
        return [];
      }
      let prevHeight = 0;
      for (let i = 0; i < 40; i++) {
        scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
        await delay(1100);
        const newHeight = scrollContainer.scrollHeight;
        if (newHeight === prevHeight) break;
        prevHeight = newHeight;
      }
      const chats = Array.from(document.querySelectorAll('.msg-conversation-listitem__link'));
      sendUpdate("progress", `Found ${chats.length} chats`);
      return chats;
    }

    const chatItems = await loadAllContacts();
    if (!chatItems.length) {
      sendUpdate("error", "No chat items found.");
      return;
    }

    const results = [];

    for (let i = 0; i < chatItems.length; i++) {
      const chat = chatItems[i];
      chat.scrollIntoView({ behavior: "smooth", block: "center" });
      chat.click();
      sendUpdate("progress", `Processing chat ${i + 1}/${chatItems.length}`);
      await delay(2800);

      const contactName =
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText?.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText?.trim() ||
        '';

      let headerHref = null;
      const headerLink = document.querySelector('.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link');
      if (headerLink) headerHref = headerLink.getAttribute('href') || headerLink.getAttribute('data-href') || null;

      const messageElements = Array.from(document.querySelectorAll('.msg-s-event-listitem__body'));
      const senderMessages = [];
      for (const el of messageElements) {
        const parent = el.closest('.msg-s-message-group, .msg-s-event-listitem');
        const isSelf = parent && parent.classList.contains('msg-s-message-group--self');
        if (!isSelf) {
          const txt = (el.innerText || '').trim();
          if (txt) senderMessages.push(txt.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
        }
      }

      const phoneRaw = extractFirstPhoneFromMessages(senderMessages);
      const phone = phoneRaw ? phoneRaw : null;
      const emailRaw = extractFirstEmailFromMessages(senderMessages);
      const email = emailRaw ? emailRaw : null;

      let linkedInUrl = null;
      if (headerHref) {
        if (headerHref.startsWith('//')) linkedInUrl = 'https:' + headerHref;
        else if (!headerHref.startsWith('http')) linkedInUrl = headerHref.startsWith('/') ? 'https://linkedin.com' + headerHref : 'https://linkedin.com/' + headerHref;
        else linkedInUrl = headerHref;
      }

      const linkedin_internal_id = extractInternalIdFromHref(headerHref || linkedInUrl) || '';

      results.push({
        contactName: contactName || '',
        linkedInUrl: linkedInUrl || '',
        linkedin_internal_id: linkedin_internal_id || '',
        phone: phone || null,
        email: email || null,
        messages: senderMessages
      });

      await delay(700);
    }

    // JSON (full extraction)
    const jsonBlob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = "linkedin_user_messages_structured.json";
    ajson.click();
    sendUpdate("progress", "JSON file downloaded");

    // Merge + dedupe (email-priority + merge missing fields)
    sendUpdate("progress", "Merging duplicates (email-priority)...");
    const unique = mergeAndDedupe(results);
    sendUpdate("progress", `Unique records after merge: ${unique.length}/${results.length}`);

    // generate SQL from unique
    const sqlText = generateUpsertSQL(unique);
    if (!sqlText || !sqlText.trim()) {
      downloadFile("upsert.sql", "-- No valid rows to insert\n");
    } else {
      downloadFile("upsert.sql", sqlText);
    }
    sendUpdate("done", "Extraction completed!");
  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }

  // --- Helpers for SQL + download ---
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function escapeSql(val) {
    if (val === null || val === undefined) return "NULL";
    return "'" + String(val).replace(/'/g, "''") + "'";
  }

  function generateUpsertSQL(rows) {
  const filtered = rows.filter(r => r.linkedInUrl);
  if (!filtered.length) return "-- No valid records\n";

  const values = filtered.map(r => {
    const fullName = r.contactName || null;
    const linkedin_id = r.linkedInUrl || null;
    const linkedin_internal_id = r.linkedin_internal_id || null;
    const phone = r.phone || null;
    const email = r.email || null;

    return "(" +
      escapeSql(fullName) + ", " +
      "NULL, " + // source_email
      escapeSql(email) + ", " +
      escapeSql(phone) + ", " +
      escapeSql(linkedin_id) + ", " +
      "NULL, NULL, CURRENT_DATE(), 0, NULL, " +
      escapeSql(linkedin_internal_id) +
    ")";
  }).join(",\n");

  return `
-- MySQL UPSERT for vendor_contact_extracts
INSERT INTO vendor_contact_extracts
  (full_name, source_email, email, phone, linkedin_id, company_name, location, extraction_date, moved_to_vendor, created_at, linkedin_internal_id)
VALUES
${values}
AS new
ON DUPLICATE KEY UPDATE
  full_name = new.full_name,
  email = new.email,
  phone = new.phone,
  linkedin_id = new.linkedin_id,
  linkedin_internal_id = new.linkedin_internal_id,
  extraction_date = new.extraction_date;
`.trim();
}
})();
