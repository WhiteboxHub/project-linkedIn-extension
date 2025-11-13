// content.js
(async () => {
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  // phone extraction regex (captures international-ish numbers)
  const PHONE_RE = /(\+?\d[\d\-\.\s\(\)]{6,}\d)/g;

  function cleanPhone(raw) {
    if (!raw) return null;
    // remove spaces, dots, parentheses, dashes but keep leading +
    let p = raw.trim();
    // keep + at start
    const hasPlus = p.startsWith('+');
    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;
    // keep only digits and leading +
    p = p.replace(/[^+\d]/g, '');
    // basic length sanity: require 6-15 digits (allow +)
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
          if (cleaned) return cleaned; // FIRST phone found in sender messages
        }
      }
    }
    return null;
  }

  function extractInternalIdFromHref(href) {
    if (!href) return null;
    // href examples: /in/john-doe, https://linkedin.com/in/john-doe, URN-like ...ACoAA...
    try {
      // attempt url parse
      const u = new URL(href, "https://linkedin.com");
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length) {
        const last = parts[parts.length - 1];
        return last || null;
      }
    } catch (e) {
      // fallback to regex
      const m1 = href.match(/\/in\/([^\/?#]+)/);
      if (m1 && m1[1]) return m1[1];
      const m2 = href.match(/(ACo[A-Za-z0-9_-]+)/);
      if (m2 && m2[1]) return m2[1];
    }
    return null;
  }

  try {
    sendUpdate("progress", "Loading conversations...");

    // 1. load all contacts by scrolling sidebar
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

    for (let index = 0; index < chatItems.length; index++) {
      const chat = chatItems[index];
      chat.scrollIntoView({ behavior: "smooth", block: "center" });
      chat.click();
      sendUpdate("progress", `Processing chat ${index + 1}/${chatItems.length}`);
      await delay(3000);

      // contact name
      const contactName =
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText.trim() ||
        null;

      // profile link / header href
      let headerHref = null;
      const headerLink = document.querySelector('.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link');
      if (headerLink) headerHref = headerLink.getAttribute('href') || headerLink.getAttribute('data-href') || null;

      // build messages by selecting only sender messages (not self)
      const messageElements = Array.from(document.querySelectorAll('.msg-s-event-listitem__body'));
      const senderMessages = [];
      for (const el of messageElements) {
        const parent = el.closest('.msg-s-message-group, .msg-s-event-listitem');
        const isSelf = parent && parent.classList.contains('msg-s-message-group--self');
        if (!isSelf) {
          const text = el.innerText.trim();
          if (text) {
            // normalize newlines into single spaces
            senderMessages.push(text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
          }
        }
      }

      // extract phone from sender messages: FIRST phone found
      const phone = extractFirstPhoneFromMessages(senderMessages);

      // prepare linkedInUrl (full)
      let linkedInUrl = null;
      if (headerHref) {
        if (headerHref.startsWith('http') || headerHref.startsWith('//')) {
          linkedInUrl = headerHref.startsWith('//') ? 'https:' + headerHref : headerHref;
        } else {
          linkedInUrl = headerHref.startsWith('/') ? ('https://linkedin.com' + headerHref) : ('https://linkedin.com/' + headerHref);
        }
      }

      // linkedin_internal_id (last path segment or URN)
      const linkedin_internal_id = extractInternalIdFromHref(headerHref || linkedInUrl);

      const existing = results.find(r => r.linkedInUrl === linkedInUrl && r.contactName === contactName);
      if (!existing) {
        results.push({
          contactName: contactName || '',
          linkedInUrl: linkedInUrl || '',
          linkedin_internal_id: linkedin_internal_id || '',
          phone: phone || null,
          messages: senderMessages
        });
      }

      await delay(1000);
    }

    // Download JSON
    const jsonFilename = "linkedin_user_messages_structured.json";
    const jsonBlob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = jsonFilename;
    ajson.click();
    sendUpdate("progress", "JSON file downloaded");

    // Generate prompt.txt
    sendUpdate("progress", "Generating prompt.txt");
    const promptText = generatePromptTextForVendor();
    downloadFile("prompt.txt", promptText);
    sendUpdate("progress", "prompt.txt downloaded");

    // Generate upsert SQL (MySQL using vendor schema)
    sendUpdate("progress", "Generating upsert.sql");
    const sqlText = generateUpsertSQL(results);
    downloadFile("upsert.sql", sqlText);
    sendUpdate("progress", "upsert.sql downloaded");

    sendUpdate("done", "Extraction + prompt + SQL generation completed.");
  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }

  // helper: download file
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Prompt generator for vendor schema (reflects user's schema)
  function generatePromptTextForVendor() {
    return [
      "Instructions for SQL generation:",
      "",
      "You are given a JSON array of contacts with the following fields:",
      " - contactName (string)",
      " - linkedInUrl (string)",
      " - linkedin_internal_id (string)",
      " - phone (string or null)",
      "",
      "Target Vendor Schema:",
      "Table name: vendor_contact_extracts",
      "Columns:",
      " - id bigint AUTO_INCREMENT PRIMARY KEY",
      " - full_name varchar(255)",
      " - source_email varchar(255) DEFAULT NULL",
      " - email varchar(255) DEFAULT NULL",
      " - phone varchar(50) DEFAULT NULL",
      " - linkedin_id varchar(255) DEFAULT NULL",
      " - company_name varchar(255) DEFAULT NULL",
      " - location varchar(255) DEFAULT NULL",
      " - extraction_date date DEFAULT NULL",
      " - moved_to_vendor tinyint(1) DEFAULT 0",
      " - created_at timestamp DEFAULT CURRENT_TIMESTAMP",
      " - linkedin_internal_id varchar(255) DEFAULT NULL",
      "",
      "Generate MySQL INSERT ... ON DUPLICATE KEY UPDATE statements",
      "that upsert data into vendor_contact_extracts.",
      "Mapping:",
      " - contactName -> full_name",
      " - linkedInUrl -> linkedin_id",
      " - linkedin_internal_id -> linkedin_internal_id",
      " - phone -> phone",
      " - extraction_date -> CURRENT_DATE()",
      "",
      "Requirements:",
      " 1) Use multi-row INSERT with ON DUPLICATE KEY UPDATE.",
      " 2) Update full_name, linkedin_internal_id, phone, extraction_date on duplicate.",
      " 3) Do not modify id or created_at.",
      " 4) Email and source_email remain NULL unless provided.",
      "",
      "Return only SQL statements; do not include commentary.",
      ""
    ].join("\n");
  }

  // escape SQL strings
  function escapeSql(val) {
    if (val === null || val === undefined) return "NULL";
    return "'" + String(val).replace(/'/g, "''") + "'";
  }

  // generate MySQL upsert SQL for vendor_contact_extracts
  function generateUpsertSQL(rows) {
    const filtered = rows.filter(r => r.linkedInUrl); // require linkedin_id for safe insert
    if (!filtered.length) return "-- No rows to insert\n";

    const values = filtered.map(r => {
      const fullName = r.contactName || null;
      const linkedin_id = r.linkedInUrl || null;
      const linkedin_internal_id = r.linkedin_internal_id || null;
      const phone = r.phone || null;
      // extraction_date as CURRENT_DATE()
      return "(" +
        escapeSql(fullName) + ", " +
        "NULL, " + // source_email
        "NULL, " + // email
        escapeSql(phone) + ", " +
        escapeSql(linkedin_id) + ", " +
        "NULL, " + // company_name
        "NULL, " + // location
        "CURRENT_DATE(), " +
        "0, " + // moved_to_vendor default
        "NULL, " + // created_at leave default
        escapeSql(linkedin_internal_id) +
      ")";
    }).join(",\n");

    const sql = `
-- MySQL upsert for vendor_contact_extracts
INSERT INTO vendor_contact_extracts
  (full_name, source_email, email, phone, linkedin_id, company_name, location, extraction_date, moved_to_vendor, created_at, linkedin_internal_id)
VALUES
${values}
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  linkedin_internal_id = VALUES(linkedin_internal_id),
  phone = VALUES(phone),
  extraction_date = VALUES(extraction_date);
`.trim();

    return sql;
  }

})();
