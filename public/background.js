const DEFAULT_API = "http://127.0.0.1:41732";

function isSupportedPage(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "lms.lausd.net" || host.endsWith(".lausd.net") || host.endsWith(".schoology.com");
  } catch {
    return false;
  }
}

async function getPageSnapshot(tab) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SAIA_CAPTURE_PAGE" });
    if (response && response.ok && response.page) return response.page;
  } catch (_) {
    // The page may have been open before the extension was installed.
  }

  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "SAIA_CAPTURE_PAGE" });
  if (!response || !response.ok || !response.page) {
    throw new Error((response && response.error) || "Could not read this page. Reload it and try again.");
  }
  return response.page;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "SAIA_ANALYZE_CURRENT") return;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") {
      throw new Error("No active tab was found.");
    }
    if (!isSupportedPage(tab.url)) {
      throw new Error("Open a page in LAUSD LMS / Schoology first.");
    }

    const settings = await chrome.storage.local.get({
      apiBaseUrl: DEFAULT_API,
      useSearch: true
    });
    const page = await getPageSnapshot(tab);
    let screenshot = null;

    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 72 });
    } catch (_) {
      // Text analysis can still run if the browser does not allow a screenshot.
    }

    const response = await fetch(String(settings.apiBaseUrl || DEFAULT_API) + "/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: page.title,
        pageUrl: page.url,
        text: page.text,
        images: screenshot ? [screenshot] : [],
        useSearch: Boolean(settings.useSearch),
        taskType: "auto"
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Local analysis failed with status " + response.status + ".");
    }
    sendResponse({ ok: true, data: payload });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown error." });
  });

  return true;
});