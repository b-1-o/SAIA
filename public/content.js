(() => {
  if (window.__SAIA_CONTENT_READY__) return;
  window.__SAIA_CONTENT_READY__ = true;

  const clean = (value, limit = 1800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const visible = (node) => {
    if (!(node instanceof Element)) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const absoluteUrl = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.protocol === "https:" ? url.href : "";
    } catch { return ""; }
  };

  function collectPage() {
    const bodyText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 30000);
    const imageDescriptions = Array.from(document.images)
      .filter((image) => image.width > 30 && image.height > 20)
      .slice(0, 100)
      .map((image, index) => {
        const alt = clean(image.alt || image.getAttribute("aria-label"), 240);
        return alt ? "Image " + (index + 1) + ": " + alt : "";
      }).filter(Boolean).join("\n");
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]"))
      .slice(0, 50).map((node) => clean(node.innerText || node.getAttribute("aria-label"), 300)).filter(Boolean).join("\n");
    return {
      title: document.title || "",
      url: location.href,
      text: [headings, bodyText, imageDescriptions].filter(Boolean).join("\n\n").slice(0, 35000),
      capturedAt: new Date().toISOString()
    };
  }

  function collectLinks() {
    const links = Array.from(document.querySelectorAll("a[href]")).filter(visible);
    const seen = new Set();
    const assignments = [];
    const courses = [];
    const attachmentExtensions = /\.(pdf|docx?|pptx?|xlsx?|rtf|txt|csv)(?:[?#]|$)/i;
    const taskWords = /assignment|assessment|quiz|test|exam|discussion|submission|activity|homework|task/i;
    const courseWords = /course|courses|section|class|group/i;
    for (const anchor of links) {
      const href = absoluteUrl(anchor.getAttribute("href"));
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const label = clean(anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || anchor.querySelector("img")?.alt, 260);
      const path = new URL(href).pathname;
      const parentText = clean(anchor.closest("li,article,[role=article],[class*=card],[class*=assignment],[class*=course],tr")?.innerText || anchor.parentElement?.innerText, 650);
      const haystack = (label + " " + href + " " + parentText).toLowerCase();
      const statusText = parentText.toLowerCase();
      let status = "unknown";
      if (/missing|not submitted|not turned in|incomplete|overdue|not complete/.test(statusText)) status = "incomplete";
      else if (/submitted|completed|complete|graded|turned in|done/.test(statusText)) status = "possibly-complete";
      if (taskWords.test(haystack) || attachmentExtensions.test(href)) {
        assignments.push({ title: label || path.split("/").filter(Boolean).pop() || "Untitled item", url: href, context: parentText, status });
      } else if (courseWords.test(haystack) && !/\/login|\/logout|\/settings|\/help/.test(path)) {
        courses.push({ title: label || path, url: href });
      }
    }
    return { assignments: assignments.slice(0, 300), courses: courses.slice(0, 100) };
  }

  function collectQuestions() {
    const selectors = [
      "[data-question-id]", "[data-testid*=question]", ".question", ".quiz-question",
      ".assessment-question", "fieldset", "[role=group]", ".question-wrapper"
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(","))).filter(visible);
    const chosen = [];
    for (const node of candidates) {
      const text = clean(node.innerText, 5000);
      if (text.length < 8) continue;
      // Avoid returning both a question card and every nested field/role group.
      if (chosen.some((item) => item.element.contains(node) || node.contains(item.element))) continue;
      const options = Array.from(node.querySelectorAll("label, [role=radio], [role=checkbox], input[type=radio], input[type=checkbox], select option"))
        .map((option) => clean(option.innerText || option.getAttribute("aria-label") || option.value || option.parentElement?.innerText, 500))
        .filter((value) => value.length > 0);
      const images = Array.from(node.querySelectorAll("img"))
        .filter((image) => image.width > 20 && image.height > 20)
        .map((image) => ({ alt: clean(image.alt, 300), src: absoluteUrl(image.currentSrc || image.src), width: image.naturalWidth, height: image.naturalHeight }))
        .slice(0, 10);
      const inputs = Array.from(node.querySelectorAll("input,textarea,select"))
        .filter((input) => !/hidden|submit|button/.test(input.type || ""))
        .map((input) => ({ type: input.type || input.tagName.toLowerCase(), name: input.name || "", label: clean(input.getAttribute("aria-label") || input.closest("label")?.innerText || input.parentElement?.innerText, 300) }))
        .slice(0, 30);
      chosen.push({ element: node, item: { index: chosen.length + 1, text, options: [...new Set(options)].slice(0, 40), images, inputs } });
    }
    if (chosen.length > 0) return chosen.map((entry) => entry.item);
    // Schoology versions often don't expose stable question classes; fall back to visible fields plus page text.
    const fields = Array.from(document.querySelectorAll("input[type=radio],input[type=checkbox],textarea,input:not([type]),select")).filter(visible);
    if (fields.length) {
      const groups = new Map();
      for (const field of fields) {
        const key = field.name || field.closest("fieldset")?.innerText || "field-" + groups.size;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(field);
      }
      return Array.from(groups.entries()).slice(0, 100).map(([key, group], index) => ({
        index: index + 1,
        text: clean(group[0].closest("fieldset")?.innerText || group[0].parentElement?.parentElement?.innerText || key, 5000),
        options: group.map((field) => clean(field.closest("label")?.innerText || field.parentElement?.innerText || field.value, 500)),
        images: [],
        inputs: group.map((field) => ({ type: field.type || field.tagName.toLowerCase(), name: field.name || "", label: clean(field.getAttribute("aria-label"), 300) }))
      }));
    }
    return [];
  }

  function collectAttachments() {
    return Array.from(document.querySelectorAll("a[href]"))
      .filter(visible)
      .map((anchor) => {
        const url = absoluteUrl(anchor.href);
        const label = clean(anchor.innerText || anchor.title || anchor.getAttribute("aria-label"), 250);
        return { title: label || url, url, filename: url ? new URL(url).pathname.split("/").pop() : "" };
      })
      .filter((item) => item.url && /\.(pdf|docx?|pptx?|xlsx?|rtf|txt|csv)(?:[?#]|$)/i.test(item.url))
      .slice(0, 100);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      if (!message) return;
      if (message.type === "SAIA_CAPTURE_PAGE") sendResponse({ ok: true, page: collectPage() });
      else if (message.type === "SAIA_COLLECT_LINKS") sendResponse({ ok: true, links: collectLinks(), title: document.title, url: location.href });
      else if (message.type === "SAIA_COLLECT_QUESTIONS") sendResponse({ ok: true, questions: collectQuestions(), title: document.title, url: location.href, pageText: collectPage().text });
      else if (message.type === "SAIA_COLLECT_ATTACHMENTS") sendResponse({ ok: true, attachments: collectAttachments(), title: document.title, url: location.href });
      else return;
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read page." });
    }
    return true;
  });
})();