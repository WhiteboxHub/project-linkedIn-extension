document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("extractBtn");
  const statusBox = document.getElementById("status");

  function updateStatus(text, type = "processing", showSpinner = false) {
    statusBox.className = type;
    statusBox.innerHTML = showSpinner
      ? `<span class="spinner"></span>${text}`
      : text;
  }

  // Listen for forwarded messages from background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.from === "background") {
      if (msg.type === "progress") {
        updateStatus(msg.text, "processing", true);
      } else if (msg.type === "done") {
        updateStatus("✅ Extraction completed! File downloaded.", "success", false);
        setTimeout(() => updateStatus("Status: Idle", "", false), 3000);
      } else if (msg.type === "error") {
        updateStatus("❌ " + msg.text, "error", false);
        setTimeout(() => updateStatus("Status: Idle", "", false), 3000);
      }
    }
  });

  // Button click → tell background to start
  button.addEventListener("click", async () => {
    updateStatus("Running extractor on current page...", "processing", true);
    chrome.runtime.sendMessage({ action: "run_extractor" });
  });
});
