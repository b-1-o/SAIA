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
      : ["Best-effort scan of LMS links and up to 20 discovered course pages. Unknown status means the LMS did not expose a reliable completion label."]
  };
}

async function captureVisibleScreenshot(tab) {
  try { return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 72 }); }
  catch (_) { return null; }
}

async function captureQuizScreenshots(tab, maxScreenshots = 6) {
  const metricsResult = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      scrollY: window.scrollY,
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
      innerHeight: window.innerHeight
    })
  });
  const metrics = metricsResult?.[0]?.result || { scrollY: 0, scrollHeight: 0, innerHeight: 800 };
  const originalY = Number(metrics.scrollY || 0);
  const viewportHeight = Math.max(1, Number(metrics.innerHeight || 800));
  const maxY = Math.max(0, Number(metrics.scrollHeight || viewportHeight) - viewportHeight);
  const step = Math.max(300, Math.floor(viewportHeight * 0.78));
  const positions = [0];
  for (let y = step; y < maxY && positions.length < maxScreenshots; y += step) positions.push(y);
  if (maxY > 0 && positions.length < maxScreenshots && positions[positions.length - 1] !== maxY) positions.push(maxY);

  const screenshots = [];
  try {
    for (const y of positions.slice(0, maxScreenshots)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, args: [y], func: (top) => window.scrollTo(0, top)
      });
      await sleep(260);
      const image = await captureVisibleScreenshot(tab);
      if (image) screenshots.push(image);
    }
  } finally {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, args: [originalY], func: (top) => window.scrollTo(0, top)
      });
    } catch (_) {}
  }
  const totalViewports = Math.max(1, Math.ceil((maxY + viewportHeight) / step));
  return { images: screenshots, capturedViewports: screenshots.length, totalViewports, partial: totalViewports > screenshots.length };
}

function downloadLmsAttachment(url, filename) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(new Error("Attachment URL is invalid.")); return; }
    if (parsed.protocol !== "https:" || !isSupportedPage(parsed.href)) {
      reject(new Error("For safety, SAIA only downloads HTTPS files hosted by the LAUSD LMS / Schoology domains."));
      return;
    }
    chrome.downloads.download({ url: parsed.href, filename: String(filename || parsed.pathname.split("/").pop() || "schoology-file").slice(0, 180), saveAs: true }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message || "Browser download failed."));
      else if (typeof downloadId !== "number") reject(new Error("Download was cancelled or did not start."));
      else resolve({ downloadId, filename: String(filename || parsed.pathname.split("/").pop() || "schoology-file") });
    });
  });
}

async function attachDraftToCurrentSubmission(tab, draft) {
  if (!isSupportedPage(tab.url)) throw new Error("Open the relevant Schoology assignment page first.");
  if (!draft || typeof draft.filename !== "string" || typeof draft.base64 !== "string") {
    throw new Error("No prepared review draft was supplied.");
  }
  if (draft.base64.length > 11500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(draft.base64)) {
    throw new Error("The draft data is invalid or too large.");
  }
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    args: [{ filename: draft.filename.slice(0, 160), mimeType: String(draft.mimeType || "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), base64: draft.base64 }],
    func: (fileData) => {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]:not(:disabled)'));
      if (!inputs.length) return { ok: false, reason: "No file upload control was found in this frame." };
      if (inputs.length > 1) {
        const visible = inputs.filter((input) => {
          const rect = input.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (visible.length !== 1) return { ok: false, reason: "Multiple upload controls were found. Select the file manually to avoid attaching it to the wrong field." };
        inputs.splice(0, inputs.length, visible[0]);
      }
      const binary = atob(fileData.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      const file = new File([bytes], fileData.filename, { type: fileData.mimeType });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      inputs[0].files = transfer.files;
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, filename: file.name, inputCount: inputs.length, note: "File attached in the page. Review the assignment and use its normal Submit button yourself." };
    }
  });
  const success = results.map((result) => result.result).find((result) => result?.ok);
  if (success) return success;
  const reason = results.map((result) => result.result?.reason).find(Boolean);
  throw new Error(reason || "Could not attach the file. Use the assignment's normal file picker.");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const supportedActions = ["SAIA_ANALYZE_CURRENT", "SAIA_SCAN_COURSES", "SAIA_ANALYZE_QUIZ", "SAIA_LIST_ATTACHMENTS", "SAIA_ATTACH_DRAFT", "SAIA_DOWNLOAD_ATTACHMENT"];
  if (!message || !supportedActions.includes(message.type)) return;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || typeof tab.id !== "number" || typeof tab.windowId !== "number") throw new Error("No active tab was found.");

    if (message.type === "SAIA_ATTACH_DRAFT") {
      const attached = await attachDraftToCurrentSubmission(tab, message.draft);
      sendResponse({ ok: true, data: attached });
      return;
    }

    if (!isSupportedPage(tab.url)) throw new Error("Open a page in LAUSD LMS / Schoology first.");
    if (message.type === "SAIA_DOWNLOAD_ATTACHMENT") {
      const downloaded = await downloadLmsAttachment(String(message.url || ""), String(message.filename || ""));
      sendResponse({ ok: true, data: downloaded });
      return;
    }
    if (message.type === "SAIA_SCAN_COURSES") {
      sendResponse({ ok: true, data: await scanCourses(tab) });
      return;
    }
    if (message.type === "SAIA_LIST_ATTACHMENTS") {
      const result = await askContentScript(tab.id, "SAIA_COLLECT_ATTACHMENTS");
      sendResponse({ ok: true, data: result });
      return;
    }

    const settings = await chrome.storage.local.get({ apiBaseUrl: DEFAULT_API, useSearch: true });
    const page = await getPageSnapshot(tab);
    let body;
    let endpoint = "/api/analyze";

    if (message.type === "SAIA_ANALYZE_QUIZ") {
      const questionData = await askContentScript(tab.id, "SAIA_COLLECT_QUESTIONS");
      const capture = await captureQuizScreenshots(tab, 6);
      const coverageNote = capture.partial
        ? "Visual coverage warning: SAIA captured " + capture.capturedViewports + " viewport images out of an estimated " + capture.totalViewports + ". Some later diagrams or images may be missing from visual analysis."
        : "Visual coverage: " + capture.capturedViewports + " viewport image(s) captured across the page.";
      body = {
        title: page.title,
        pageUrl: page.url,
        text: page.text + "\n\n" + coverageNote,
        questions: questionData.questions || [],
        images: capture.images,
        useSearch: Boolean(settings.useSearch)
      };
      endpoint = "/api/analyze-quiz";
    } else {
      const screenshot = await captureVisibleScreenshot(tab);
      body = {
        title: page.title, pageUrl: page.url, text: page.text,
        images: screenshot ? [screenshot] : [],
        useSearch: Boolean(settings.useSearch), taskType: "auto"
      };
    }

    const response = await fetch(String(settings.apiBaseUrl || DEFAULT_API) + endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Local analysis failed with status " + response.status + ".");
    sendResponse({ ok: true, data: payload });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unknown error." });
  });
  return true;
});