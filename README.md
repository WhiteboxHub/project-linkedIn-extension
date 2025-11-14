# 📨 LinkedIn Message Extractor

> Chrome extension that extracts LinkedIn messages, detects sender phone numbers, and generates JSON + prompt + MySQL upsert SQL (`upsert.sql`) for `vendor_contact_extracts`.

## Overview
This extension:
- Scans LinkedIn Messaging conversations.
- Extracts only the other user's (sender) messages for each conversation.
- Detects the **first phone number** found in sender messages and maps it to the `phone` column.
- Generates and downloads:
  - `linkedin_user_messages_structured.json`
  - `prompt.txt` (SQL generation instructions for your schema)
  - `upsert.sql` (MySQL `INSERT ... ON DUPLICATE KEY UPDATE` using `vendor_contact_extracts` schema)

## Phone extraction behavior
- **Only phone numbers from the sender (not your replies)** are considered.
- **If multiple numbers appear**, the extension stores **the first phone number found**.
- Phone numbers are normalized (remove spaces/dots/dashes, preserve leading `+`).

## Vendor schema mapping
- Table: `vendor_contact_extracts`
- Mapping:
  - `contactName` → `full_name`
  - `linkedInUrl` → `linkedin_id`
  - `linkedin_internal_id` → `linkedin_internal_id`
  - `phone` → `phone`
  - `extraction_date` → `CURRENT_DATE()`

## Files generated
- `linkedin_user_messages_structured.json` — full extracted JSON
- `prompt.txt` — instructions describing the schema and required SQL
- `upsert.sql` — MySQL upsert SQL ready to run against your DB

## Installation & Usage
1. Clone repository
2. `chrome://extensions/` → Developer mode → Load unpacked → project folder
3. Open `https://www.linkedin.com/messaging/`
4. Click extension icon → `Extract Messages`
5. Monitor progress in popup; files download automatically when done

## Notes
- If LinkedIn changes DOM structure, update selectors in `content.js`.
- `upsert.sql` uses `INSERT ... ON DUPLICATE KEY UPDATE` and requires MySQL/compatible server.
- `phone` will be `NULL` if not found in sender messages.

## License
MIT
