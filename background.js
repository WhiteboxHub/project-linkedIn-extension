chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  // Handle request from popup to start extraction
  if (message.action === "run_extractor") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url.includes("linkedin.com/messaging")) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      sendResponse({ status: "started" });
    } else {
      chrome.tabs.create({ url: "https://www.linkedin.com/messaging/" });
    }
  }

  // Forward progress messages from content to popup
  if (message.from === "content") {
    chrome.runtime.sendMessage({
      from: "background",
      type: message.type,
      text: message.text
    });
  }

  return true;
});
