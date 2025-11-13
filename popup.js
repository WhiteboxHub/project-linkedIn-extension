// popup.js
document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("extractBtn");
  const statusBox = document.getElementById("status");

  function updateStatus(text, type = "", spinner = false) {
    statusBox.className = type;
    statusBox.innerHTML = spinner ? `<span class="spinner"></span>${text}` : text;
  }

  // Listen to background forwarded messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.from === "background") {
      if (msg.type === "progress") {
        updateStatus(msg.text, "processing", true);
      } else if (msg.type === "done") {
        updateStatus("✅ Extraction completed! Files downloaded.", "success", false);
        setTimeout(() => updateStatus("Status: Idle", "", false), 3000);
      } else if (msg.type === "error") {
        updateStatus("❌ " + msg.text, "error", false);
        setTimeout(() => updateStatus("Status: Idle", "", false), 3000);
      }
    }
  });

  button.addEventListener("click", async () => {
    updateStatus("Running extractor on current page...", "processing", true);
    chrome.runtime.sendMessage({ action: "run_extractor" });
  });
});
