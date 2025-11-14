// Calls LLM API with JSON data and returns generated SQL
async function callLLMAPI(jsonData, config, customPrompt = null) {
  const { llmApiProvider, llmApiKey, llmApiEndpoint, llmModelName } = config;

  if (!llmApiKey || !llmApiEndpoint || !llmModelName) {
    throw new Error("LLM configuration is incomplete. Please configure in popup.");
  }

  let prompt;
  if (customPrompt) {
    prompt = customPrompt;
  } else if (jsonData && jsonData._prompt) {
    prompt = jsonData._prompt;
  } else if (jsonData) {
    prompt = `You are a MySQL database expert and data extraction specialist. Generate a MySQL UPSERT SQL script from the following LinkedIn contact data.

CRITICAL INSTRUCTIONS:
1. Check if email and phone fields already have values in the JSON. If they do, USE THOSE VALUES.
2. If email or phone is null or empty in JSON, extract them from the messages array.
3. YOU MUST INCLUDE email and phone fields in the SQL INSERT statement, even if they are NULL.
4. For phone numbers: ALWAYS REMOVE the "+" sign if present. Store phone numbers as digits only (e.g., "+1234567890" → "1234567890").

The JSON contains LinkedIn contact information with the following fields:
- contactName: Full name of the contact
- linkedInUrl: LinkedIn profile URL (normalized)
- linkedin_internal_id: Internal LinkedIn ID (e.g., ACo...)
- phone: May contain a phone number OR be null - if null, extract from messages
- email: May contain an email address OR be null - if null, extract from messages
- messages: Array of message strings from this contact - search here if email/phone are null

EXTRACTION RULES (only if email/phone are null):
1. Extract email addresses from the messages array. Look for patterns like: email@domain.com, contact me at email@example.com, etc.
2. Extract phone numbers from the messages array. Look for patterns like: +1234567890, (123) 456-7890, 123-456-7890, etc.
3. Normalize extracted data:
   - Normalize emails to lowercase
   - Normalize phone numbers: REMOVE the "+" sign if present, keep only digits (e.g., "+1234567890" becomes "1234567890")
   - Use the first valid email/phone if multiple found

The target table is: vendor_contact_extracts
Table columns (INCLUDE ALL OF THESE IN YOUR SQL):
- full_name (VARCHAR) - map from contactName
- source_email (VARCHAR, can be NULL) - ALWAYS set to NULL
- email (VARCHAR, can be NULL) - USE email field from JSON OR extract from messages - THIS FIELD MUST BE IN SQL
- phone (VARCHAR, can be NULL) - USE phone field from JSON OR extract from messages - THIS FIELD MUST BE IN SQL
- linkedin_id (VARCHAR) - map from linkedInUrl
- company_name (VARCHAR, can be NULL) - ALWAYS set to NULL
- location (VARCHAR, can be NULL) - ALWAYS set to NULL
- extraction_date (DATE) - use CURRENT_DATE()
- moved_to_vendor (INT, default 0) - ALWAYS set to 0
- created_at (DATETIME, can be NULL) - ALWAYS set to NULL
- linkedin_internal_id (VARCHAR) - map from linkedin_internal_id

CRITICAL SQL REQUIREMENTS:
1. Generate MySQL UPSERT using: INSERT INTO vendor_contact_extracts (...) VALUES (...) ON DUPLICATE KEY UPDATE ...
2. The duplicate key is on linkedin_id
3. Include email and phone columns in BOTH the INSERT column list AND the VALUES clause
4. Include email and phone in the ON DUPLICATE KEY UPDATE clause
5. Only include records where linkedInUrl is not empty
6. For email: Use the value from JSON email field, or extract from messages, or use NULL
7. For phone: Use the value from JSON phone field, or extract from messages, or use NULL
8. Use proper SQL escaping: Replace single quotes with two single quotes ('')
9. Set NULL explicitly as NULL (not as string 'NULL')

PHONE NUMBER FORMATTING:
- If phone number contains "+" sign, REMOVE it before inserting into SQL
- Example: "+1234567890" should become "1234567890" in the SQL
- Keep only digits, no special characters or "+" prefix

EXAMPLE SQL STRUCTURE (follow this format exactly):
INSERT INTO vendor_contact_extracts
  (full_name, source_email, email, phone, linkedin_id, company_name, location, extraction_date, moved_to_vendor, created_at, linkedin_internal_id)
VALUES
('John Doe', NULL, 'john@example.com', '1234567890', 'https://linkedin.com/in/xyz', NULL, NULL, CURRENT_DATE(), 0, NULL, 'ACo123'),
('Jane Smith', NULL, NULL, NULL, 'https://linkedin.com/in/abc', NULL, NULL, CURRENT_DATE(), 0, NULL, 'ACo456')
AS new
ON DUPLICATE KEY UPDATE
  full_name = new.full_name,
  email = new.email,
  phone = new.phone,
  linkedin_id = new.linkedin_id,
  linkedin_internal_id = new.linkedin_internal_id,
  extraction_date = new.extraction_date;

Return ONLY the SQL code, no explanations, no markdown formatting, no code blocks. Just pure SQL.

JSON Data:
${JSON.stringify(jsonData, null, 2)}`;
  } else {
    throw new Error("No data or prompt provided");
  }

  try {
    let response;

    if (llmApiProvider === "gemini") {
      const url = llmApiEndpoint.replace("{model}", llmModelName);
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": llmApiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      throw new Error("Invalid Gemini response format");

    } else {
      const url = llmApiProvider === "azure"
        ? llmApiEndpoint.replace("{model}", llmModelName)
        : llmApiEndpoint;

      const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${llmApiKey}`
      };

      if (llmApiProvider === "azure") {
        headers["api-key"] = llmApiKey;
      }

      response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          model: llmModelName,
          messages: [{
            role: "user",
            content: prompt
          }],
          temperature: 0.1,
          max_tokens: 8000
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content.trim();
      }
      throw new Error("Invalid API response format");
    }
  } catch (error) {
    throw new Error(`LLM API call failed: ${error.message}`);
  }
}

// Validates if SQL string contains basic UPSERT syntax
function validateSQL(sql) {
  if (!sql || typeof sql !== "string") {
    console.log("SQL validation failed: not a string or empty");
    return false;
  }
  const trimmed = sql.trim().toUpperCase();
  const hasInsert = trimmed.includes("INSERT");
  const hasUpsert = trimmed.includes("ON DUPLICATE KEY UPDATE");
  const hasValues = trimmed.includes("VALUES");
  
  if (!hasInsert) {
    console.log("SQL validation failed: missing INSERT");
    return false;
  }
  if (!hasUpsert && !hasValues) {
    console.log("SQL validation failed: missing ON DUPLICATE KEY UPDATE or VALUES");
    return false;
  }
  return true;
}

// Checks if API key timestamp has exceeded 30 minute expiration
function isApiKeyExpired(savedTimestamp) {
  if (!savedTimestamp) return true;
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;
  return (now - savedTimestamp) > thirtyMinutes;
}

// Main message listener for extension communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Injects content script into LinkedIn messaging tab
  if (message.action === "run_extractor") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url.includes("linkedin.com/messaging")) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"]
        });
        sendResponse({ status: "started" });
      } else {
        chrome.tabs.create({ url: "https://www.linkedin.com/messaging/" });
        sendResponse({ status: "started" });
      }
    })();
    return true;
  }

  // Handles LLM API call request with retry logic and SQL validation
  if (message.action === "call_llm") {
    (async () => {
      try {
        const config = await chrome.storage.sync.get([
          "llmApiProvider",
          "llmApiKey",
          "llmApiEndpoint",
          "llmModelName",
          "llmApiKeyTimestamp"
        ]);

        if (config.llmApiKeyTimestamp && isApiKeyExpired(config.llmApiKeyTimestamp)) {
          await chrome.storage.sync.remove(["llmApiKey", "llmApiKeyTimestamp"]);
          sendResponse({ success: false, error: "API key has expired (30 minute limit). Please reconfigure in the extension popup." });
          return;
        }

        let sqlResult = null;
        let retryCount = 0;
        const maxRetries = 2;

        while (retryCount <= maxRetries && !sqlResult) {
          try {
            const sql = await callLLMAPI(message.jsonData, config);
            console.log("LLM returned SQL, length:", sql?.length);

            if (validateSQL(sql)) {
              let cleanSQL = sql;
              if (cleanSQL.includes("```")) {
                const matches = cleanSQL.match(/```(?:sql)?\s*([\s\S]*?)```/);
                if (matches && matches[1]) {
                  cleanSQL = matches[1].trim();
                } else {
                  cleanSQL = cleanSQL.replace(/```/g, '').trim();
                }
              }
              sqlResult = cleanSQL;
              console.log("SQL validation passed, using LLM SQL");
            } else {
              console.log("SQL validation failed, attempting fix. SQL preview:", sql?.substring(0, 200));
              if (retryCount < maxRetries) {
                const validationPrompt = `The following SQL is invalid or incomplete. Please fix it and return ONLY valid MySQL UPSERT syntax with INSERT ... ON DUPLICATE KEY UPDATE. No explanations, just the SQL code.\n\nInvalid SQL:\n${sql}`;
                const fixedSQL = await callLLMAPI(null, config, validationPrompt);
                if (validateSQL(fixedSQL)) {
                  let cleanSQL = fixedSQL;
                  if (cleanSQL.includes("```")) {
                    const matches = cleanSQL.match(/```(?:sql)?\s*([\s\S]*?)```/);
                    if (matches && matches[1]) {
                      cleanSQL = matches[1].trim();
                    } else {
                      cleanSQL = cleanSQL.replace(/```/g, '').trim();
                    }
                  }
                  sqlResult = cleanSQL;
                  console.log("Fixed SQL validation passed");
                } else {
                  console.log("Fixed SQL still failed validation");
                  retryCount++;
                  if (retryCount <= maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                  }
                }
              } else {
                console.log("Max retries reached, SQL validation failed");
                retryCount++;
              }
            }

            if (!sqlResult && retryCount <= maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (error) {
            console.error("LLM API call error:", error.message);
            retryCount++;
            if (retryCount > maxRetries) {
              sendResponse({ success: false, error: `LLM API failed after ${maxRetries + 1} attempts: ${error.message}` });
              return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        if (!sqlResult) {
          sendResponse({ success: false, error: "LLM generated SQL but validation failed after all retries. The SQL may not contain required INSERT and ON DUPLICATE KEY UPDATE syntax." });
          return;
        }

        console.log("Sending SQL response to content script, length:", sqlResult.length);
        try {
          sendResponse({ success: true, sql: sqlResult });
          console.log("Response sent via sendResponse");
          
          setTimeout(() => {
            chrome.runtime.sendMessage({
              from: "background",
              action: "llm_response",
              success: true,
              sql: sqlResult
            }).catch(err => {
              if (err.message !== "Could not establish connection. Receiving end does not exist.") {
                console.error("Failed to send alternative response:", err);
              }
            });
          }, 100);
        } catch (err) {
          console.error("Error in sendResponse, using alternative method:", err);
          chrome.runtime.sendMessage({
            from: "background",
            action: "llm_response",
            success: true,
            sql: sqlResult
          }).catch(console.error);
        }
      } catch (error) {
        console.error("Error in LLM handler:", error);
        try {
          sendResponse({ success: false, error: error.message });
          setTimeout(() => {
            chrome.runtime.sendMessage({
              from: "background",
              action: "llm_response",
              success: false,
              error: error.message
            }).catch(console.error);
          }, 100);
        } catch (err) {
          console.error("Error sending error response:", err);
          chrome.runtime.sendMessage({
            from: "background",
            action: "llm_response",
            success: false,
            error: error.message
          }).catch(console.error);
        }
      }
    })();
    return true;
  }

  // Forwards status messages from content script to popup
  if (message.from === "content") {
    chrome.runtime.sendMessage({
      from: "background",
      type: message.type,
      text: message.text
    });
    return true;
  }

  return true;
});
