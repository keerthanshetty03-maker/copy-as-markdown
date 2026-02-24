if (window.__copyAsMarkdownInjected) {
  console.log("Copy as Markdown: already injected");
} else {
  window.__copyAsMarkdownInjected = true;

console.log("Copy as Markdown: content script loaded on", window.location.href);

function getSelectionHtml() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "";

  const range = sel.getRangeAt(0);
  const container = document.createElement("div");
  container.appendChild(range.cloneContents());

  return container.innerHTML;
}

// Clean tracking parameters from URLs
function cleanUrl(urlString) {
  try {
    const url = new URL(urlString);
    const trackerParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "gclid", "fbclid", "mc_cid", "mc_eid", "igshid"
    ];
    
    trackerParams.forEach(param => {
      url.searchParams.delete(param);
    });
    
    return url.toString();
  } catch (e) {
    return urlString;
  }
}

// Get smart label for a URL
function getSmartLabel(urlString) {
  try {
    const url = new URL(urlString);
    const currentUrl = new URL(window.location.href);
    
    // If same origin, use document title
    if (url.origin === currentUrl.origin) {
      const title = (document.title || "").trim();
      return title || url.hostname;
    }
    
    // Otherwise use domain name
    return url.hostname;
  } catch (e) {
    return urlString;
  }
}

// Post-process Markdown to handle plain URLs and ensure proper link formatting
function processMarkdownLinks(markdown) {
  // Match plain URLs (not already in Markdown link format)
  // Negative lookbehind to avoid URLs already in [text](url) format
  const urlRegex = /(?<!\[.*)\b(https?:\/\/[^\s\[\]]+)(?!\))/g;
  
  let processed = markdown;
  const matches = [...markdown.matchAll(urlRegex)];
  
  // Process in reverse order to maintain correct positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const urlString = match[1];
    const start = match.index;
    const end = start + urlString.length;
    
    try {
      const cleanedUrl = cleanUrl(urlString);
      const label = getSmartLabel(cleanedUrl);
      const markdownLink = `[${label}](${cleanedUrl})`;
      
      processed = processed.substring(0, start) + markdownLink + processed.substring(end);
    } catch (e) {
      // Skip if processing fails for this URL
    }
  }
  
  return processed;
}

// Detect if text looks like a citation marker
function isCitationText(text) {
  if (!text) return false;
  
  const trimmed = text.trim();
  
  // Numeric markers: 9, 12, 9a, 12b (1-3 digits optionally followed by 1 letter)
  if (/^\d{1,3}[a-zA-Z]?$/.test(trimmed)) return true;
  
  // Bracketed numeric markers: [9], [[9]]
  if (/^\[+\d{1,3}[a-zA-Z]?\]+$/.test(trimmed)) return true;
  
  // Escaped brackets: [\[9\]]
  if (/^\[\\?\[?\d{1,3}[a-zA-Z]?\\?\]?\]$/.test(trimmed)) return true;
  
  // Note/ref markers: note 3, ref 7 (case-insensitive, optional space)
  if (/^(note|ref)\s*\d{1,3}$/i.test(trimmed)) return true;
  
  // Symbol markers: *, †, ‡, §
  if (/^[*†‡§]$/.test(trimmed)) return true;
  
  return false;
}

// Normalize citation text to footnote label
function normalizeCitationLabel(text) {
  if (!text) return null;
  let t = text.trim();

  // Unescape \[ and \]
  t = t.replace(/\\\[/g, "[").replace(/\\\]/g, "]");

  // If it's like [[9]] or [9], remove all surrounding brackets
  t = t.replace(/^\[+/, "").replace(/\]+$/, "");

  // Numeric-like: 9, 12, 9a
  if (/^\d{1,3}[a-zA-Z]?$/.test(t)) return t.toLowerCase();

  // note/ref: note 3, ref7
  const m = t.match(/^(note|ref)\s*(\d{1,3})$/i);
  if (m) return (m[1] + m[2]).toLowerCase();

  // Symbol markers: keep raw symbol so caller can decide fn#
  if (/^[*†‡§]$/.test(t)) return t;

  return null;
}

// Convert citations to footnotes in Markdown
function convertCitationsToFootnotes(markdown) {
  // Map to track: normalized label -> footnote ID
  // Also track URL -> footnote ID for deduplication
  const labelToId = {};
  const urlToId = {};
  let autoGenCounter = 1;
  const footnotes = [];
  
  // Match Markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let processed = markdown;
  const matches = [...markdown.matchAll(linkRegex)];
  
  // Process in reverse order to maintain correct positions
  for (let i = matches.length - 1; i >= 0; i--) {
    const match = matches[i];
    const linkText = match[1];
    const linkUrl = match[2];
    const fullMatch = match[0];
    const start = match.index;
    
    // Check if link text is a citation marker
    if (!isCitationText(linkText)) {
      continue; // Skip non-citation links
    }
    
    try {
      // Convert relative URL to absolute
      let absoluteUrl = linkUrl;
      try {
        absoluteUrl = new URL(linkUrl, window.location.href).toString();
      } catch (e) {
        // Keep as-is if conversion fails
      }
      
      // Clean tracking parameters
      const cleanedUrl = cleanUrl(absoluteUrl);
      
      // Normalize the citation label
      const normalizedLabel = normalizeCitationLabel(linkText);
      
      // Determine footnote ID
      let footnoteId;
      
      // Check if this URL already has a footnote (deduplication)
      if (urlToId[cleanedUrl]) {
        footnoteId = urlToId[cleanedUrl];
      } else if (normalizedLabel && /^[*†‡§]$/.test(normalizedLabel)) {
        // Symbol markers: auto-generate [^fn1], [^fn2], ...
        footnoteId = `fn${autoGenCounter}`;
        autoGenCounter++;
      } else if (normalizedLabel && !labelToId[normalizedLabel]) {
        // Numeric or note/ref: use normalized label
        footnoteId = normalizedLabel;
        labelToId[normalizedLabel] = footnoteId;
      } else if (normalizedLabel) {
        // Reuse existing
        footnoteId = labelToId[normalizedLabel];
      } else {
        // Ambiguous: auto-generate
        footnoteId = `fn${autoGenCounter}`;
        autoGenCounter++;
      }
      
      // Track this URL
      if (!urlToId[cleanedUrl]) {
        urlToId[cleanedUrl] = footnoteId;
        footnotes.push({ id: footnoteId, url: cleanedUrl });
      }
      
      // Replace link with footnote marker
      // Ensure space before if attached to a word
      const beforeMatch = markdown.substring(Math.max(0, start - 1), start);
      const needsSpace = beforeMatch && /\w/.test(beforeMatch);
      const replacementMarker = needsSpace ? ` [^${footnoteId}]` : `[^${footnoteId}]`;
      
      processed = processed.substring(0, start) + replacementMarker + processed.substring(start + fullMatch.length);
    } catch (e) {
      // Skip this link if processing fails
      continue;
    }
  }
  
  footnotes.reverse();
  // Append footnote definitions at the end
  if (footnotes.length > 0) {
    processed += "\n\n";
    for (const fn of footnotes) {
      processed += `[^${fn.id}]: ${fn.url}\n`;
    }
  }
  
  return processed;
}

function htmlToMarkdown(html) {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-"
  });

  // Make relative links absolute and clean tracking params
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
      // Clean tracking params from anchor URLs
      abs = cleanUrl(abs);
      const text = (content || "").trim();
      return text ? `[${text}](${abs})` : `<${abs}>`;
    }
  });

  let md = service.turndown(html);
  md = md.replace(/\n{3,}/g, "\n\n").trim();
  
  // Post-process to handle plain URLs
  md = processMarkdownLinks(md);
  
  // Post-process to convert citation links to footnotes
  md = convertCitationsToFootnotes(md);
  
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
}
