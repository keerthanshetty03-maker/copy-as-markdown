console.log("Copy as Markdown: content script loaded on", window.location.href);

function getSelectionHtml() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";

  const range = sel.getRangeAt(0);
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());

  return container.innerHTML;
}

function htmlToMarkdown(html) {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-"
  });

  // Make relative links absolute
  service.addRule("absoluteLinks", {
    filter: function (node) {
      return node.nodeName === "A" && node.getAttribute("href");
    },
    replacement: function (content, node) {
      const href = node.getAttribute("href") || "";
      let abs = href;
      try {
        abs = new URL(href, window.location.href).toString();
      } catch (e) {
        // leave as-is if it cannot be resolved (javascript:, mailto:, or malformed)
        abs = href;
      }
      const text = (content || "").trim();
      return text ? `[${text}](${abs})` : `<${abs}>`;
    }
  });

  let md = service.turndown(html);
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  return md;
}


async function copyText(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (e) {
    // fallback to legacy approach
  }

  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "none";
  ta.style.outline = "none";
  ta.style.boxShadow = "none";
  ta.style.background = "transparent";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (err) {
    console.warn("Copy fallback failed:", err);
  }
  ta.remove();
}

function showToast(message) {
  const el = document.createElement("div");
  el.textContent = message;

  Object.assign(el.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    padding: "10px 12px",
    background: "rgba(0,0,0,0.85)",
    color: "white",
    fontSize: "13px",
    borderRadius: "10px",
    zIndex: 999999
  });

  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "COPY_SELECTION_AS_MD") return;

  (async () => {
    try {
      const html = getSelectionHtml();
      if (!html) {
        sendResponse({ ok: false, error: "No selection" });
        return;
      }

      const md = htmlToMarkdown(html);
      await copyText(md);
      showToast("Copied as Markdown ✅");

      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();

  return true;
});
