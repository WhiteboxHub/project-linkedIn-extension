(async () => {
  function sendUpdate(type, text) {
    chrome.runtime.sendMessage({ from: "content", type, text });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  try {
    sendUpdate("progress", "Loading conversations...");

    async function loadAllContacts() {
      const scrollContainer = document.querySelector('.msg-conversations-container__conversations-list');
      if (!scrollContainer) {
        sendUpdate("error", "Conversation list not found. Open LinkedIn Messaging page.");
        return [];
      }

      let prevHeight = 0;
      for (let i = 0; i < 40; i++) {
        scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
        await delay(1500);
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
      await delay(4000);

      const contactName =
        document.querySelector('.msg-entity-lockup__entity-title')?.innerText.trim() ||
        chat.querySelector('.msg-conversation-listitem__participant-names')?.innerText.trim() ||
        "Unknown";

      let linkedInUrl = null;
      const headerLink = document.querySelector(
        '.msg-thread__link-to-profile, .msg-overlay-bubble-header__recipient-link, .msg-entity-lockup__entity-link'
      );

      if (headerLink) {
        const href = headerLink.getAttribute('href');
        if (href) {
          const matchUser = href.match(/\/in\/([^\/?#]+)/);
          if (matchUser && matchUser[1]) {
            linkedInUrl = `https://linkedin.com/in/${matchUser[1]}`;
          }
          if (!linkedInUrl) {
            const matchUrn = href.match(/ACo[A-Za-z0-9_-]+/);
            if (matchUrn && matchUrn[0]) {
              linkedInUrl = `https://linkedin.com/in/${matchUrn[0]}`;
            }
          }
        }
      }

      const messageScroll = document.querySelector('.msg-s-message-list__scroll-container') ||
                            document.querySelector('.msg-thread__scrollable');
      if (messageScroll) {
        let lastScrollTop = -1;
        for (let i = 0; i < 20; i++) {
          if (messageScroll.scrollTop === lastScrollTop) break;
          lastScrollTop = messageScroll.scrollTop;
          messageScroll.scrollTop = 0;
          await delay(1500);
        }
      }

      const messageElements = document.querySelectorAll('.msg-s-event-listitem__body');
      const userMessages = [];

      for (const msg of messageElements) {
        const text = msg.innerText.trim();
        if (!text) continue;

        const parent = msg.closest('.msg-s-message-group, .msg-s-event-listitem');
        const isSelf = parent && parent.classList.contains('msg-s-message-group--self');
        if (!isSelf) {
          const cleanMessage = text.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
          userMessages.push(cleanMessage);
        }
      }

      const existing = results.find(r => r.linkedInUrl === linkedInUrl && r.contactName === contactName);
      if (!existing) {
        results.push({ contactName, linkedInUrl, messages: userMessages });
      }

      await delay(2000);
    }

    // Save JSON file
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "linkedin_user_messages_structured.json";
    a.click();

    sendUpdate("done", "Extraction completed!");
  } catch (err) {
    sendUpdate("error", err.message);
  }
})();
