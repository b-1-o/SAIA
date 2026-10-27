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
      const parsedUrl = new URL(href);
      const host = parsedUrl.hostname.toLowerCase();
      const isLmsHost = host === "lms.lausd.net" || host.endsWith(".lausd.net") ||
        host === "schoology.com" || host.endsWith(".schoology.com");
      if (!isLmsHost) continue;
      seen.add(href);
      const label = clean(anchor.innerText || anchor.getAttribute("aria-label") || anchor.title || anchor.querySelector("img")?.alt, 260);
      const path = parsedUrl.pathname;
      const parentText = clean(anchor.closest("li,article,[role=article],[class*=card],[class*=assignment],[class*=course],tr")?.innerText || anchor.parentElement?.innerText, 650);
      const identityText = (label + " " + path).toLowerCase();
      const statusText = parentText.toLowerCase();
      let status = "unknown";
      if (/missing|not submitted|not turned in|incomplete|overdue|not complete/.test(statusText)) status = "incomplete";
      else if (/submitted|completed|complete|graded|turned in|done/.test(statusText)) status = "possibly-complete";
      const taskPath = /\/(assignment|assessment|quiz|test|exam|discussion)(\/|$)/i.test(path);
      const navigationLabel = /^(skip to content|terms of use|privacy policy|help|settings|grades|messages|logout|log out)$/i.test(label);
      if (!navigationLabel && (taskPath || (taskWords.test(identityText) && !/terms of use|privacy policy|skip to content/i.test(label)) || attachmentExtensions.test(href))) {
        assignments.push({ title: label || path.split("/").filter(Boolean).pop() || "Untitled item", url: href, context: parentText, status });
      } else if (!navigationLabel && (/(^|\/)course(s)?(\/|$)/i.test(path) || courseWords.test(identityText)) && !/\/login|\/logout|\/settings|\/help/i.test(path)) {
        courses.push({ title: label || path, url: href });
      }
    }
    return { assignments: assignments.slice(0, 300), courses: courses.slice(0, 100) };
  }

  function collectQuestions() {
    // Schoology/LAUSD's assessment renderer: stay inside the currently open assessment form.
    // Never crawl course links or unrelated LMS content while a quiz is active.
    const assessmentRoot = document.querySelector(
      "#s-assessment-question-fill-form, form.s-assessment-question-fill-form, form[id*=assessment-question-fill]"
    );

    if (assessmentRoot) {
      const questionNodes = Array.from(assessmentRoot.querySelectorAll(".question-wrapper"))
        .filter(visible)
        .slice(0, 6);

      return questionNodes.map((node, position) => {
        const titleNode = node.querySelector(
          ".question-title, [data-question-title], .question-prompt, .question-text"
        );
        const wholeHeader = node.querySelector(".question-question");
        const headerText = clean(titleNode?.innerText || wholeHeader?.innerText || node.innerText, 1800);
        const numberText = clean(node.querySelector(".question-number")?.innerText, 80);
        const numberMatch = numberText.match(/(?:question\s*)?(\d+)/i);
        const index = numberMatch ? Number(numberMatch[1]) : position + 1;

        // On this Schoology page, the label contains only the choice letter (a/b/c/d);
        // the actual answer text is in the adjacent .form-radio-answer cell.
        const optionRows = Array.from(node.querySelectorAll(
          ".form-radios-table tr, .form-radios tr, .multiple-choices tr"
        ));
        let options = optionRows.map((row) => {
          const answerCell = row.querySelector(".form-radio-answer, [id*='-description']");
          return clean(answerCell?.innerText || "", 600);
        }).filter(Boolean);

        if (!options.length) {
          options = Array.from(node.querySelectorAll(
            "[role=radio], [role=checkbox], select option, label.option, label"
          )).map((option) => {
            const explicitText = option.getAttribute("aria-label") || option.getAttribute("data-label");
            const siblingText = option.closest("tr")?.querySelector(".form-radio-answer, [id*='-description']")?.innerText;
            const value = clean(siblingText || explicitText || option.innerText || "", 600);
            return value.replace(/^[a-d]\s+/i, "").trim();
          }).filter(Boolean);
        }
        options = [...new Set(options)].slice(0, 12);

        const images = Array.from(node.querySelectorAll("img"))
          .filter((image) => image.width > 20 && image.height > 20)
          .map((image) => ({
            alt: clean(image.alt, 240),
            src: absoluteUrl(image.currentSrc || image.src),
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height
          }))
          .slice(0, 4);

        const inputs = Array.from(node.querySelectorAll("input,textarea,select"))
          .filter((input) => !/hidden|submit|button/.test(input.type || ""))
          .map((input) => ({
            type: input.type || input.tagName.toLowerCase(),
            name: input.name || "",
            label: clean(input.getAttribute("aria-label") || input.closest("label")?.innerText || "", 180)
          }))
          .slice(0, 12);

        return {
          index,
          text: headerText,
          options,
          images,
          inputs
        };
      }).filter((question) => question.text.length >= 8);
    }

    // Generic fallback for other LMS renderers. Use only this tab's rendered question groups.
    const preferredSelectors = [
      "[data-question-id]", "[data-testid*=question]", ".quiz-question",
      ".assessment-question", ".question-wrapper", ".question"
    ];
    let candidates = [];
    for (const selector of preferredSelectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(visible);
      if (matches.length > 0) {
        candidates = matches;
        break;
      }
    }
    if (!candidates.length) {
      candidates = Array.from(document.querySelectorAll("fieldset, [role=group]")).filter(visible);
    }

    const chosen = [];
    for (const node of candidates) {
      const text = clean(node.innerText, 1800);
      if (text.length < 8) continue;
      if (chosen.some((entry) => entry.element.contains(node) || node.contains(entry.element))) continue;
      const options = Array.from(node.querySelectorAll(
        ".form-radio-answer, [role=radio], [role=checkbox], input[type=radio], input[type=checkbox], select option, label"
      )).map((option) => clean(option.innerText || option.getAttribute("aria-label") || option.value || "", 500))
        .filter((value) => value.length > 0);
      const images = Array.from(node.querySelectorAll("img"))
        .filter((image) => image.width > 20 && image.height > 20)
        .map((image) => ({ alt: clean(image.alt, 240), src: absoluteUrl(image.currentSrc || image.src), width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }))
        .slice(0, 4);
      const inputs = Array.from(node.querySelectorAll("input,textarea,select"))
        .filter((input) => !/hidden|submit|button/.test(input.type || ""))
        .map((input) => ({ type: input.type || input.tagName.toLowerCase(), name: input.name || "", label: clean(input.getAttribute("aria-label") || input.closest("label")?.innerText || "", 180) }))
        .slice(0, 12);
      chosen.push({ element: node, item: { index: chosen.length + 1, text, options: [...new Set(options)].slice(0, 12), images, inputs } });
    }
    if (chosen.length > 0) return chosen.slice(0, 6).map((entry) => entry.item);

    const fields = Array.from(document.querySelectorAll("input[type=radio],input[type=checkbox],textarea,input:not([type]),select")).filter(visible);
    if (fields.length) {
      const groups = new Map();
      for (const field of fields) {
        const key = field.name || field.closest("fieldset")?.innerText || "field-" + groups.size;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(field);
      }
      return Array.from(groups.entries()).slice(0, 6).map(([key, group], index) => ({
        index: index + 1,
        text: clean(group[0].closest("fieldset")?.innerText || group[0].parentElement?.parentElement?.innerText || key, 1800),
        options: group.map((field) => clean(field.closest("label")?.innerText || field.parentElement?.innerText || field.value, 300)),
        images: [],
        inputs: group.map((field) => ({ type: field.type || field.tagName.toLowerCase(), name: field.name || "", label: clean(field.getAttribute("aria-label"), 180) }))
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