document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("extractBtn");
  const statusBox = document.getElementById("status");
  const configToggle = document.getElementById("configToggle");
  const configContent = document.getElementById("configContent");
  const configArrow = document.getElementById("configArrow");
  const apiProvider = document.getElementById("apiProvider");
  const apiKey = document.getElementById("apiKey");
  const apiEndpoint = document.getElementById("apiEndpoint");
  const modelName = document.getElementById("modelName");
  const saveConfigBtn = document.getElementById("saveConfigBtn");
  const configStatus = document.getElementById("configStatus");

  const defaultEndpoints = {
    groq: "https://api.groq.com/openai/v1/chat/completions",
    openai: "https://api.openai.com/v1/chat/completions",
    gemini: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    azure: "https://your-resource.openai.azure.com/openai/deployments/{model}/chat/completions?api-version=2024-02-15-preview"
  };

  const defaultModels = {
    groq: "llama-3.3-70b-versatile",
    openai: "gpt-4o-mini",
    gemini: "gemini-1.5-flash",
    azure: "gpt-4o"
  };

  const availableModels = {
    groq: [
      { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile" },
      { value: "llama-3.1-70b-versatile", label: "Llama 3.1 70B Versatile" },
      { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
      { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B" },
      { value: "gemma-7b-it", label: "Gemma 7B IT" }
    ],
    openai: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }
    ],
    gemini: [
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
      { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
      { value: "gemini-pro", label: "Gemini Pro" }
    ],
    azure: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
      { value: "gpt-35-turbo", label: "GPT-3.5 Turbo" }
    ]
  };

  // Updates status display with text, type, and optional spinner
  function updateStatus(text, type = "", spinner = false) {
    statusBox.className = type;
    statusBox.innerHTML = spinner ? `<span class="spinner"></span>${text}` : text;
  }

  // Checks if API key timestamp has exceeded 30 minute expiration
  function isApiKeyExpired(savedTimestamp) {
    if (!savedTimestamp) return true;
    const now = Date.now();
    const thirtyMinutes = 30 * 60 * 1000;
    return (now - savedTimestamp) > thirtyMinutes;
  }

  // Removes expired API key from storage and clears input field
  async function clearExpiredApiKey() {
    const result = await chrome.storage.sync.get(["llmApiKeyTimestamp"]);
    if (result.llmApiKeyTimestamp && isApiKeyExpired(result.llmApiKeyTimestamp)) {
      await chrome.storage.sync.remove(["llmApiKey", "llmApiKeyTimestamp"]);
      apiKey.value = "";
      return true;
    }
    return false;
  }

  // Toggles configuration panel visibility
  configToggle.addEventListener("click", () => {
    configContent.classList.toggle("active");
    configArrow.textContent = configContent.classList.contains("active") ? "▲" : "▼";
  });

  // Populates model dropdown with provider-specific models
  function updateModelDropdown() {
    const provider = apiProvider.value;
    const models = availableModels[provider] || [];
    modelName.innerHTML = "";
    
    models.forEach(model => {
      const option = document.createElement("option");
      option.value = model.value;
      option.textContent = model.label;
      modelName.appendChild(option);
    });
    
    if (models.length > 0) {
      const defaultModel = defaultModels[provider] || models[0].value;
      modelName.value = defaultModel;
      modelName.dataset.lastValue = defaultModel;
    }
  }

  // Loads saved configuration from storage and checks API key expiration
  async function loadConfig() {
    try {
      const wasExpired = await clearExpiredApiKey();

      const result = await chrome.storage.sync.get([
        "llmApiProvider",
        "llmApiKey",
        "llmApiEndpoint",
        "llmModelName",
        "llmApiKeyTimestamp"
      ]);

      if (!result.llmApiProvider) {
        apiProvider.value = "groq";
        apiEndpoint.value = defaultEndpoints.groq;
        apiEndpoint.dataset.lastPlaceholder = defaultEndpoints.groq;
        updateModelDropdown();
        modelName.value = defaultModels.groq;
        modelName.dataset.lastValue = defaultModels.groq;
      } else {
        if (result.llmApiProvider) {
          apiProvider.value = result.llmApiProvider;
          updateEndpointPlaceholder();
        }

        if (result.llmApiKey && result.llmApiKeyTimestamp) {
          if (isApiKeyExpired(result.llmApiKeyTimestamp)) {
            apiKey.value = "";
            if (wasExpired) {
              configStatus.textContent = "⏰ API key expired (30 min limit). Please re-enter.";
              configStatus.className = "config-status";
            }
          } else {
            const now = Date.now();
            const thirtyMinutes = 30 * 60 * 1000;
            const elapsed = now - result.llmApiKeyTimestamp;
            const remaining = Math.max(0, thirtyMinutes - elapsed);
            const remainingMinutes = Math.floor(remaining / 60000);

            if (remainingMinutes > 0) {
              apiKey.value = result.llmApiKey;
              configStatus.textContent = `⏰ API key expires in ${remainingMinutes} min`;
              configStatus.className = "config-status";
              setTimeout(() => {
                configStatus.textContent = "";
              }, 5000);
            } else {
              apiKey.value = "";
            }
          }
        } else {
          apiKey.value = "";
        }

        if (result.llmApiEndpoint) {
          apiEndpoint.value = result.llmApiEndpoint;
        }
        
        updateModelDropdown();
        
        if (result.llmModelName) {
          if (modelName.querySelector(`option[value="${result.llmModelName}"]`)) {
            modelName.value = result.llmModelName;
          } else {
            modelName.value = defaultModels[result.llmApiProvider] || availableModels[result.llmApiProvider]?.[0]?.value || "";
          }
        } else if (result.llmApiProvider) {
          modelName.value = defaultModels[result.llmApiProvider] || availableModels[result.llmApiProvider]?.[0]?.value || "";
        }
      }
    } catch (err) {
      console.error("Error loading config:", err);
      apiProvider.value = "groq";
      apiEndpoint.value = defaultEndpoints.groq;
      updateModelDropdown();
      modelName.value = defaultModels.groq;
    }
  }

  // Updates API endpoint placeholder based on selected provider
  function updateEndpointPlaceholder() {
    const provider = apiProvider.value;
    const endpoint = defaultEndpoints[provider] || "";
    apiEndpoint.placeholder = endpoint;
    if (!apiEndpoint.value || apiEndpoint.value === apiEndpoint.dataset.lastPlaceholder) {
      apiEndpoint.value = endpoint;
      apiEndpoint.dataset.lastPlaceholder = endpoint;
    }
    updateModelDropdown();
  }

  // Updates endpoint and model when provider selection changes
  apiProvider.addEventListener("change", () => {
    updateEndpointPlaceholder();
  });

  // Saves configuration to storage with 30 minute expiration timestamp
  saveConfigBtn.addEventListener("click", async () => {
    const config = {
      llmApiProvider: apiProvider.value,
      llmApiKey: apiKey.value,
      llmApiEndpoint: apiEndpoint.value,
      llmModelName: modelName.value,
      llmApiKeyTimestamp: Date.now()
    };

    if (!config.llmApiKey || !config.llmApiEndpoint || !config.llmModelName) {
      configStatus.textContent = "❌ Please fill all fields";
      configStatus.className = "config-status";
      setTimeout(() => {
        configStatus.textContent = "";
      }, 3000);
      return;
    }

    try {
      await chrome.storage.sync.set(config);
      configStatus.textContent = "✅ Configuration saved! (Expires in 30 min)";
      configStatus.className = "config-status saved";
      setTimeout(() => {
        configStatus.textContent = "";
      }, 5000);
    } catch (err) {
      configStatus.textContent = "❌ Error saving configuration";
      configStatus.className = "config-status";
      console.error("Error saving config:", err);
    }
  });

  // Initializes default Groq values on first load
  function initializeDefaults() {
    if (!apiEndpoint.value && !apiEndpoint.dataset.initialized) {
      apiEndpoint.value = defaultEndpoints.groq;
      apiEndpoint.dataset.lastPlaceholder = defaultEndpoints.groq;
      apiEndpoint.dataset.initialized = "true";
    }
    updateModelDropdown();
    if (!modelName.value && !modelName.dataset.initialized) {
      modelName.value = defaultModels.groq;
      modelName.dataset.lastValue = defaultModels.groq;
      modelName.dataset.initialized = "true";
    }
  }

  loadConfig().then(() => {
    initializeDefaults();
  });

  // Listens for status messages from background script and updates UI
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

  // Triggers extraction when extract button is clicked
  button.addEventListener("click", async () => {
    updateStatus("Running extractor on current page...", "processing", true);
    chrome.runtime.sendMessage({ action: "run_extractor" });
  });
});
