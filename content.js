// content.js — Final Version Without prompt.txt Generation
(async () => {
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // Phone extraction regex
  const PHONE_RE = /(\+?\d[\d\-\.\s\(\)]{6,}\d)/g;

  // Email extraction regex
  const EMAIL_RE = /([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g;

  function cleanPhone(raw) {
    if (!raw) return null;

    let p = raw.trim();
    const hasPlus = p.startsWith('+');

    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;

    p = p.replace(/[^+\d]/g, '');

    const digits = p.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return null;

    return p;
  }

  function extractFirstPhoneFromMessages(messages) {
    if (!messages || !messages.length) return null;

    for (const m of messages) {
      const matches = m.match(PHONE_RE);
      if (matches && matches.length) {
        for (const raw of matches) {
          const cleaned = cleanPhone(raw);
          if (cleaned) return cleaned;
        }
      }
    }
    return null;
  }

  function extractFirstEmailFromMessages(messages) {
    if (!messages || !messages.length) return null;

    for (const m of messages) {
      const matches = m.match(EMAIL_RE);
      if (matches && matches.length) {
        return matches[0]; // first valid email
      }
    }
    return null;
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

  try {
    sendUpdate("progress", "Loading conversations...");

    // STEP 1 — Load all contacts
    async function loadAllContacts() {
      const scrollContainer = document.querySelector('.msg-conversations-container__conversations-list');
      if (!scrollContainer) {
        sendUpdate("error", "Conversation list not found. Open LinkedIn Messaging page.");
        return [];
      }

      let prevHeight = 0;
      for (let i = 0; i < 40; i++) {
        scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
        await delay(1200);
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

    // STEP 2 — Process each chat
    for (let index = 0; index < chatItems.length; index++) {
      const chat = chatItems[index];

      chat.scrollIntoView({ behavior: "smooth", block: "center" });
      chat.click();
      sendUpdate("progress", `Processing chat ${index + 1}/${chatItems.length}`);

      await delay(3000);

      // Contact name
      const contactName =
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText.trim() ||
        null;

      // Profile link
      let headerHref = null;
      const headerLink = document.querySelector(
        '.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link'
      );
      if (headerLink)
        headerHref = headerLink.getAttribute('href') || headerLink.getAttribute('data-href') || null;

      // Extract sender messages (not self)
      const messageElements = Array.from(document.querySelectorAll('.msg-s-event-listitem__body'));
      const senderMessages = [];

      for (const el of messageElements) {
        const parent = el.closest('.msg-s-message-group, .msg-s-event-listitem');
        const isSelf = parent && parent.classList.contains('msg-s-message-group--self');
        if (!isSelf) {
          const text = el.innerText.trim();
          if (text)
            senderMessages.push(text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
        }
      }

      // Extract phone + email
      const phone = extractFirstPhoneFromMessages(senderMessages);
      const email = extractFirstEmailFromMessages(senderMessages);

      // Build LinkedIn full URL
      let linkedInUrl = null;
      if (headerHref) {
        if (headerHref.startsWith('http') || headerHref.startsWith('//')) {
          linkedInUrl = headerHref.startsWith('//') ? 'https:' + headerHref : headerHref;
        } else {
          linkedInUrl =
            headerHref.startsWith('/') ?
            ('https://linkedin.com' + headerHref) :
            ('https://linkedin.com/' + headerHref);
        }
      }

      // Internal ID
      const linkedin_internal_id = extractInternalIdFromHref(headerHref || linkedInUrl);

      results.push({
        contactName: contactName || '',
        linkedInUrl: linkedInUrl || '',
        linkedin_internal_id: linkedin_internal_id || '',
        phone: phone || null,
        email: email || null,
        messages: senderMessages
      });

      await delay(1000);
    }

    // STEP 3 — Download JSON
    const jsonBlob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = "linkedin_user_messages_structured.json";
    ajson.click();

    sendUpdate("progress", "JSON file downloaded");

    // STEP 4 — upsert.sql
    sendUpdate("progress", "Generating upsert.sql");
    const sqlText = generateUpsertSQL(results);
    downloadFile("upsert.sql", sqlText);

    sendUpdate("done", "Extraction completed!");

  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }

  // ----------------------------------------
  // HELPER FUNCTIONS
  // ----------------------------------------

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
    if (!filtered.length) return "-- No valid contacts to insert\n";

    const values = filtered.map(r => {
      const fullName = r.contactName || null;
      const linkedin_id = r.linkedInUrl || null;
      const linkedin_internal_id = r.linkedin_internal_id || null;
      const phone = r.phone || null;
      const email = r.email || null;

      return "(" +
        escapeSql(fullName) + ", " +
        "NULL, " +            // source_email
        escapeSql(email) + ", " + // email
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
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  email = VALUES(email),
  phone = VALUES(phone),
  linkedin_internal_id = VALUES(linkedin_internal_id),
  extraction_date = VALUES(extraction_date);
`.trim();
  }

})();

