(() => {
  if (window.__SAIA_CONTENT_READY__) return;
  window.__SAIA_CONTENT_READY__ = true;

  function collectPage() {
    const bodyText = (document.body && document.body.innerText ? document.body.innerText : "")
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 24000);

    const imageDescriptions = Array.from(document.images)
      .filter((image) => image.width > 30 && image.height > 20)
      .slice(0, 60)
      .map((image, index) => {
        const alt = (image.alt || image.getAttribute("aria-label") || "").trim();
        return alt ? "Image " + (index + 1) + ": " + alt : "";
      })
      .filter(Boolean)
      .join("\n");

    const headings = Array.from(document.querySelectorAll("h1,h2,h3,[role=heading]"))
      .slice(0, 40)
      .map((node) => (node.innerText || node.getAttribute("aria-label") || "").trim())
      .filter(Boolean)
      .join("\n");

    return {
      title: document.title || "",
      url: location.href,
      text: [headings, bodyText, imageDescriptions].filter(Boolean).join("\n\n").slice(0, 30000),
      capturedAt: new Date().toISOString()
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "SAIA_CAPTURE_PAGE") return;
    try {
      sendResponse({ ok: true, page: collectPage() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Could not read page." });
    }
    return true;
  });
})();