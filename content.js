(async () => {
  const PHONE_RE = /(\+?\d[\d\-\.\s\(\)]{6,}\d)/g;
  const EMAIL_RE = /([a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g;

  // Sends status update message to popup via background script
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  // Creates a delay promise for specified milliseconds
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Waits for a DOM selector to appear with timeout
  async function waitForSelector(selector, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await delay(100);
    }
    return null;
  }

  // Cleans and normalizes a raw phone number string
  function cleanPhone(raw) {
    if (!raw) return null;
    let p = String(raw).trim();
    const hasPlus = p.startsWith('+');
    p = p.replace(/[\s\-\.\(\)]/g, '');
    if (hasPlus && !p.startsWith('+')) p = '+' + p;
    p = p.replace(/[^+\d]/g, '');
    const digits = p.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return null;
    return p;
  }

  // Generates a normalized phone key for deduplication
  function phoneKey(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    return digits.replace(/^0+/, '');
  }

  // Extracts the first valid phone number from message array
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

  // Extracts the first valid email address from message array
  function extractFirstEmailFromMessages(messages) {
    if (!messages || !messages.length) return null;
    for (const msg of messages) {
      const m = msg.match(EMAIL_RE);
      if (m && m.length) return m[0].trim();
    }
    return null;
  }

  // Normalizes email address to lowercase for key generation
  function normalizeEmailForKey(email) {
    if (!email) return null;
    return String(email).trim().toLowerCase();
  }

  // Normalizes contact name for key generation
  function normalizeNameForKey(name) {
    if (!name) return null;
    return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Normalizes LinkedIn URL to canonical format
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

  // Extracts LinkedIn internal ID from href URL
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

  // Normalizes LinkedIn internal ID for key generation
  function normalizeInternalIdForKey(id) {
    if (!id) return null;
    return String(id).trim().toLowerCase();
  }

  // Merges and deduplicates contact records using email-priority algorithm
  function mergeAndDedupe(rows) {
    const mapByEmail = new Map();
    const mapByInternal = new Map();
    const mapByLinkedIn = new Map();
    const mapByPhone = new Map();
    const mapByName = new Map();
    const merged = [];

    // Registers all keys for an item in the mapping indexes
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

    // Finds existing record index by matching keys
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
        const existing = merged[idx];
        const existingHasEmail = existing.email && String(existing.email).trim() !== '';
        const incomingHasEmail = row.email && String(row.email).trim() !== '';

        if (incomingHasEmail && !existingHasEmail) {
          const mergedObj = {
            contactName: existing.contactName || row.contactName || '',
            linkedInUrl: existing.linkedInUrl || row.linkedInUrl || '',
            linkedin_internal_id: existing.linkedin_internal_id || row.linkedin_internal_id || '',
            phone: existing.phone || row.phone || null,
            email: row.email || existing.email || null,
            messages: Array.from(new Set([...(existing.messages || []), ...(row.messages || [])]))
          };
          merged[idx] = mergedObj;
          registerMaps(merged[idx], idx);
        } else {
          existing.contactName = existing.contactName || row.contactName || '';
          existing.linkedInUrl = existing.linkedInUrl || row.linkedInUrl || '';
          existing.linkedin_internal_id = existing.linkedin_internal_id || row.linkedin_internal_id || '';
          existing.phone = existing.phone || row.phone || null;
          existing.email = existing.email || row.email || null;
          const set = new Set(existing.messages || []);
          for (const m of (row.messages || [])) set.add(m);
          existing.messages = Array.from(set);
          registerMaps(existing, idx);
        }
      }
    }

    return merged;
  }

  // Scrolls through conversation list and returns all chat elements
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

  // Downloads a file with given filename and content
  function downloadFile(filename, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Generates SQL via LLM API with automatic batching for large datasets
  async function generateSQLViaLLM(jsonData) {
    const MAX_BATCH_SIZE = 150000;
    const jsonString = JSON.stringify(jsonData, null, 2);

    if (jsonString.length > MAX_BATCH_SIZE) {
      sendUpdate("progress", `JSON too large (${Math.round(jsonString.length / 1024)}KB). Batching...`);
      return await generateSQLInBatches(jsonData, MAX_BATCH_SIZE);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("LLM API call timed out after 60 seconds"));
      }, 60000);

      // Listen for response message as fallback
      const messageListener = (msg) => {
        if (msg.from === "background" && msg.action === "llm_response") {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(messageListener);
          console.log("Received LLM response via message listener");
          if (msg.success && msg.sql) {
            console.log("Resolving with LLM SQL, length:", msg.sql.length);
            resolve(msg.sql);
          } else {
            console.error("LLM response indicates failure:", msg.error);
            reject(new Error(msg.error || "LLM failed to generate SQL"));
          }
        }
      };
      chrome.runtime.onMessage.addListener(messageListener);

      try {
        console.log("Sending LLM request to background script...");
        chrome.runtime.sendMessage({
          action: "call_llm",
          jsonData: jsonData
        }, (response) => {
          console.log("Callback invoked, response:", response ? "received" : "null");
          
          if (chrome.runtime.lastError) {
            console.error("Runtime error in callback:", chrome.runtime.lastError.message);
            if (!response) {
              clearTimeout(timeout);
              chrome.runtime.onMessage.removeListener(messageListener);
              reject(new Error(chrome.runtime.lastError.message));
            }
            return;
          }
          if (response) {
            clearTimeout(timeout);
            chrome.runtime.onMessage.removeListener(messageListener);
            console.log("Response received via callback, success:", response.success, "has SQL:", !!response.sql);
            if (response.success && response.sql) {
              console.log("Resolving with LLM SQL, length:", response.sql.length);
              resolve(response.sql);
            } else {
              console.error("Response indicates failure:", response.error);
              reject(new Error(response.error || "LLM failed to generate SQL"));
            }
          } else {
            console.log("No response in callback, waiting for message listener...");
          }
        });
        console.log("Message sent, waiting for response...");
      } catch (err) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(messageListener);
        console.error("Error sending message:", err);
        reject(new Error(`Failed to send LLM request: ${err.message}`));
      }
    });
  }

  // Processes large JSON datasets in batches to avoid API limits
  async function generateSQLInBatches(jsonData, maxSize) {
    const batches = [];
    let currentBatch = [];
    let currentSize = 0;
    const baseSize = 100;

    for (const item of jsonData) {
      const itemSize = JSON.stringify(item).length;
      if (currentSize + itemSize + baseSize > maxSize && currentBatch.length > 0) {
        batches.push([...currentBatch]);
        currentBatch = [item];
        currentSize = itemSize;
      } else {
        currentBatch.push(item);
        currentSize += itemSize;
      }
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    sendUpdate("progress", `Processing ${batches.length} batches...`);
    const sqlParts = [];

    for (let i = 0; i < batches.length; i++) {
      sendUpdate("progress", `Generating SQL for batch ${i + 1}/${batches.length}...`);
      try {
        const sql = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: "call_llm",
            jsonData: batches[i]
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response || !response.success) {
              reject(new Error(response?.error || "Unknown error"));
              return;
            }
            resolve(response.sql);
          });
        });
        sqlParts.push(sql);
        await delay(1000);
      } catch (err) {
        sendUpdate("progress", `Batch ${i + 1} failed: ${err.message}. Continuing...`);
      }
    }

    if (sqlParts.length === 0) {
      throw new Error("All batches failed");
    }

    return sqlParts.join("\n\n");
  }

  // Escapes SQL string values for safe insertion
  function escapeSql(val) {
    if (val === null || val === undefined) return "NULL";
    return "'" + String(val).replace(/'/g, "''") + "'";
  }

  // Generates fallback SQL when LLM generation fails
  function generateFallbackSQL(rows) {
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
        "NULL, " +
        escapeSql(email) + ", " +
        escapeSql(phone) + ", " +
        escapeSql(linkedin_id) + ", " +
        "NULL, NULL, CURRENT_DATE(), 0, NULL, " +
        escapeSql(linkedin_internal_id) +
      ")";
    }).join(",\n");

    return `
-- LLM Failed, Generated with Fallback function
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

  try {
    sendUpdate("progress", "Loading conversations...");

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
      const headerLinkEl = await waitForSelector('.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link', 5000);
      if (headerLinkEl) headerHref = headerLinkEl.getAttribute('href') || headerLinkEl.getAttribute('data-href') || null;

      await waitForSelector('.msg-s-event-listitem__body', 5000);
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
        let tmp;
        if (headerHref.startsWith('//')) tmp = 'https:' + headerHref;
        else if (!headerHref.startsWith('http')) tmp = headerHref.startsWith('/') ? 'https://www.linkedin.com' + headerHref : 'https://www.linkedin.com/' + headerHref;
        else tmp = headerHref;
        linkedInUrl = normalizeLinkedInUrl(tmp);
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

    sendUpdate("progress", "Merging duplicate contacts...");
    const unique = mergeAndDedupe(results);
    sendUpdate("progress", `Unique records after merge: ${unique.length}/${results.length}`);

    const jsonBlob = new Blob([JSON.stringify(unique, null, 2)], { type: "application/json" });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const ajson = document.createElement("a");
    ajson.href = jsonUrl;
    ajson.download = "linkedin_user_messages_structured.json";
    ajson.click();
    sendUpdate("progress", "JSON file downloaded");

    sendUpdate("progress", "Generating SQL via LLM...");
    try {
      const sqlText = await generateSQLViaLLM(unique);
      if (!sqlText || !sqlText.trim()) {
        downloadFile("upsert.sql", "-- No valid rows to insert\n");
        sendUpdate("progress", "SQL file generated (empty)");
      } else {
        downloadFile("upsert.sql", sqlText.trim());
        sendUpdate("progress", "SQL file generated and downloaded");
        sendUpdate("done", "Extraction completed! (Generated using LLM)");
      }
    } catch (err) {
      sendUpdate("error", `LLM failed: ${err.message}`);
      sendUpdate("progress", "LLM failed, trying with fallback function...");
      await delay(1000);
      const fallbackSQL = generateFallbackSQL(unique);
      downloadFile("upsert.sql", fallbackSQL);
      sendUpdate("done", "Extraction completed! (Generated using fallback)");
    }
  } catch (err) {
    sendUpdate("error", err.message || String(err));
  }
})();
