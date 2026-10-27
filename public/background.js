const DEFAULT_API = "http://127.0.0.1:41732";
const ALLOWED_HOSTS = ["lms.lausd.net", "lausd.net", "schoology.com"];

function isSupportedPage(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith("." + domain));
  } catch { return false; }
}

function isSafeCourseUrl(url) {
  if (!isSupportedPage(url)) return false;
  try {
    const parsed = new URL(url);
    return !/\/login|\/logout|\/settings|\/help|\/messages|\/grades/i.test(parsed.pathname);
  } catch { return false; }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getPageSnapshot(tab) {
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SAIA_CAPTURE_PAGE" });
    if (response && response.ok && response.page) return response.page;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "SAIA_CAPTURE_PAGE" });
  if (!response || !response.ok || !response.page) throw new Error(response?.error || "Could not read this page. Reload it and try again.");
  return response.page;
}

async function askContentScript(tabId, type) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type });
    if (response?.ok) return response;
  } catch (_) {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const response = await chrome.tabs.sendMessage(tabId, { type });
  if (!response?.ok) throw new Error(response?.error || "Could not inspect the LMS page.");
  return response;
}

function waitForTabComplete(tabId, timeoutMs = 18000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      error ? reject(error) : resolve();
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(() => finish(new Error("A course page took too long to load.")), timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") finish();
    }).catch((error) => finish(error));
  });
}

async function scanCourseUrl(course) {
  let tabId;
  try {
    const tab = await chrome.tabs.create({ url: course.url, active: false });
    tabId = tab.id;
    if (typeof tabId !== "number") throw new Error("Could not open a temporary course tab.");
    try { await waitForTabComplete(tabId, 18000); } catch (_) { /* SPA content may still be available */ }
    await sleep(900);
    const result = await askContentScript(tabId, "SAIA_COLLECT_LINKS");
    return (result.links?.assignments || []).map((item) => ({ ...item, course: course.title, courseUrl: course.url, discoveredFrom: result.url }));
  } catch (error) {
    return [{ title: course.title, url: course.url, course: course.title, status: "unknown", context: "", scanError: error instanceof Error ? error.message : "Scan failed" }];
  } finally {
    if (typeof tabId === "number") {
      try { await chrome.tabs.remove(tabId); } catch (_) {}
    }
  }
}

async function scanCourses(startTab) {
  const initial = await askContentScript(startTab.id, "SAIA_COLLECT_LINKS");
  const courses = initial.links?.courses || [];
  const directAssignments = (initial.links?.assignments || []).map((item) => ({
    ...item, course: initial.title || "Current page", courseUrl: initial.url, discoveredFrom: initial.url
  }));
  const currentUrl = new URL(initial.url);
  const uniqueCourses = [];
  const seenCourses = new Set([currentUrl.href]);
  for (const course of courses) {
    if (!isSafeCourseUrl(course.url) || seenCourses.has(course.url)) continue;
    seenCourses.add(course.url);
    uniqueCourses.push(course);
    if (uniqueCourses.length >= 20) break;
  }

  const scanned = [];
  // Keep the number of simultaneous temporary tabs low on memory-constrained computers.
  for (let i = 0; i < uniqueCourses.length; i += 3) {
    const batch = uniqueCourses.slice(i, i + 3);
    const results = await Promise.all(batch.map(scanCourseUrl));
    scanned.push(...results.flat());
  }

  const merged = new Map();
  for (const item of [...directAssignments, ...scanned]) {
    const key = item.url || item.title;
    if (!merged.has(key)) merged.set(key, item);
    else {
      const previous = merged.get(key);
      if (previous.status === "unknown" && item.status !== "unknown") merged.set(key, item);
    }
  }
  const assignments = Array.from(merged.values()).slice(0, 300);
  await chrome.storage.local.set({
    saiaAssignments: assignments,
    saiaScanMeta: { scannedAt: new Date().toISOString(), courses: uniqueCourses.length, sourceUrl: initial.url }
  });
  return {
    assignments,
    coursesScanned: uniqueCourses.length,
    scanUrl: initial.url,
    warnings: uniqueCourses.length === 0
      ? ["No course links were found on this page. Open the LMS courses/dashboard page and try again."]
      : ["This is a best-effort scan of links visible in the LMS and up to 20 discovered course pages. Items with unknown status need manual checking."]
  };
}

async function captureVisibleScreenshot(tab) {
  try { return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 72 }); }
  catch (_) { return null; }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !["SAIA_ANALYZE_CURRENT", "SAIA_SCAN_COURSES", "SAIA_ANALYZE_QUIZ", "SAIA_LIST_ATTACHMENTS"].includes(message.type)) return;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") throw new Error("No active tab was found.");
    if (!isSupportedPage(tab.url)) throw new Error("Open a page in LAUSD LMS / Schoology first.");

    if (message.type === "SAIA_SCAN_COURSES") {
      const scan = await scanCourses(tab);
      sendResponse({ ok: true, data: scan });
      return;
    }

    if (message.type === "SAIA_LIST_ATTACHMENTS") {
      const result = await askContentScript(tab.id, "SAIA_COLLECT_ATTACHMENTS");
      sendResponse({ ok: true, data: result });
      return;
    }

    const settings = await chrome.storage.local.get({ apiBaseUrl: DEFAULT_API, useSearch: true });
    const page = await getPageSnapshot(tab);
    const screenshot = await captureVisibleScreenshot(tab);
    let body;

    if (message.type === "SAIA_ANALYZE_QUIZ") {
      const questionData = await askContentScript(tab.id, "SAIA_COLLECT_QUESTIONS");
      body = {
        title: page.title,
        pageUrl: page.url,
        text: page.text,
        questions: questionData.questions || [],
        images: screenshot ? [screenshot] : [],
        useSearch: Boolean(settings.useSearch)
      };
    } else {
      body = {
        title: page.title,
        pageUrl: page.url,
        text: page.text,
        images: screenshot ? [screenshot] : [],
        useSearch: Boolean(settings.useSearch),
        taskType: "auto"
      };
    }

    const endpoint = message.type === "SAIA_ANALYZE_QUIZ" ? "/api/analyze-quiz" : "/api/analyze";
    const response = await fetch(String(settings.apiBaseUrl || DEFAULT_API) + endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Local analysis failed with status " + response.status + ".");
    sendResponse({ ok: true, data: payload });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown error." });
  });
  return true;
});