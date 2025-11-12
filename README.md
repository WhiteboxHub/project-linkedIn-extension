# 📨 LinkedIn Message Extractor

> A Chrome extension that automatically extracts all your LinkedIn messages — along with contact names and profile URLs — and exports them into a structured JSON file.

---

## 🚀 Overview

The LinkedIn Message Extractor is a lightweight Chrome Extension built using Manifest V3 that automates the process of collecting all your LinkedIn conversations directly from LinkedIn Messaging.

It scrolls through your message list, opens each conversation, extracts every message sent by your contacts, and downloads a structured JSON file containing:

- Contact Name
- LinkedIn Profile URL
- All messages sent by that contact

The extension runs directly inside your browser — no backend server, no data uploads, and no external dependencies.

---

## ✨ Features

✅ Automatic Chat Extraction – Scans all available conversations and opens them one by one.
✅ Structured JSON Output – Each contact and their messages are neatly formatted.
✅ Live Progress Updates – Displays real-time logs like:

Found 35 chats
Processing chat 1/35
Processing chat 2/35
✅ Extraction completed! File downloaded.

✅ LinkedIn Profile Links – Extracts full LinkedIn profile URLs (not just URNs).
✅ Polished UI – LinkedIn-blue popup with curved edges, smooth transitions, and a live loading spinner.
✅ Completely Offline – Works only in your browser, no external API calls.

---

## 🧠 Example Output

[
  {
    "contactName": "John Doe",
    "linkedInUrl": "https://linkedin.com/in/ACoAAE1TZN8BrclzjEXWOtZH-tNVx5AYXYKmzCI",
    "messages": [
      "Hi John, it's great connecting with you!",
      "Are you still hiring for the ML role?",
      "Please let me know if we can schedule a chat."
    ]
  },
  {
    "contactName": "Jane Smith",
    "linkedInUrl": "https://linkedin.com/in/ACoAADwnQXUB6A9pDq6uPqPL7zsK8AZOAWM8k5A",
    "messages": [
      "Hey there, hope you’re doing well!",
      "We have an opening for an AI Engineer position."
    ]
  }
]

---

## 🧩 Tech Stack

Component | Technology
-----------|-------------
UI | HTML, CSS, JavaScript
Extension Architecture | Chrome Manifest V3
Communication | chrome.runtime.sendMessage + background relay
Permissions | activeTab, scripting, downloads
Output Format | JSON file

---

## 🧰 Folder Structure

linkedin-message-extractor/
├── manifest.json
├── background.js
├── content.js
├── popup.html
├── popup.js
└── icons/
    ├── icon1.png   (16x16)
    ├── icon2.png   (48x48)
    └── icon3.png   (128x128)

---

## ⚙️ Installation Guide

Step 1. Clone or Download the Repository
git clone https://github.com/WhiteboxHub/project-linkedIn-extension.git

Step 2. Open Chrome Extensions
Go to: chrome://extensions/

Step 3. Enable Developer Mode
Turn on the Developer mode switch (top-right corner).

Step 4. Load the Extension
Click “Load unpacked” and select your project folder.

Step 5. Open LinkedIn Messaging
Visit: https://www.linkedin.com/messaging/

Step 6. Run the Extractor
1. Click the LinkedIn Message Extractor icon in Chrome toolbar.
2. Click “Extract Messages”.
3. Watch live progress in the popup window.
4. When finished, your .json file will download automatically.

---

## 📂 Output File

Your downloaded file will be named:
linkedin_user_messages_structured.json

You can open it with:
- Visual Studio Code
- JSON Viewer Chrome Extension
- Any text editor

---

## 🔒 Privacy & Data

This extension:
- Does not send your data anywhere.
- Runs locally on your machine.
- Uses no external APIs or storage.

Your LinkedIn messages remain completely private.

---

## 🎨 UI Preview

Popup States

State | Description
------|--------------
🟢 Processing | Spinner animation shows ongoing extraction
✅ Completed | Shows download success message
⚪ Idle | Resets after 3 seconds automatically

---

## 🧠 How It Works

1. The popup triggers a background request (run_extractor).
2. The background script injects content.js into the LinkedIn tab.
3. content.js scrolls through all conversations.
4. Opens each chat → extracts name, profile link, and messages.
5. Sends progress updates (e.g., “Processing chat 5/35”) back to popup.
6. After completion, generates a JSON file and triggers browser download.

