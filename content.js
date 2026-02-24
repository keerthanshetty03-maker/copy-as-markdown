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

// Fast URL to absolute: avoid URL parsing if not needed
function makeAbsoluteFast(href) {
  if (!href) return href;
  // Already absolute (http/https)?
  if (/^https?:\/\//.test(href)) return href;
  try {
    return new URL(href, window.location.href).toString();
  } catch (e) {
    return href;
  }
}

// Fast URL cleaning: avoid URL parsing if no query string or likely trackers
function cleanUrlFast(urlString) {
  if (!urlString || !urlString.includes("?")) {
    return urlString; // No query string, nothing to clean
  }
  // Check if any tracker params are present
  const trackers = ["utm_", "gclid", "fbclid", "mc_cid", "mc_eid", "igshid"];
  if (!trackers.some(t => urlString.includes(t))) {
    return urlString; // No trackers detected
  }
  // Parse and clean
  return cleanUrl(urlString);
}

// Canonicalize marker text: unescape \[ \], strip brackets, trim
function canonicalizeMarkerText(text) {
  if (!text) return "";
  
  // Trim whitespace
  let t = text.trim();
  
  // Unescape \[ and \]
  t = t.replace(/\\\[/g, "[").replace(/\\\]/g, "]");
  
  // Strip all surrounding brackets ([ and ])
  t = t.replace(/^\[+/, "").replace(/\]+$/, "");
  
  // Trim again after bracket removal
  return t.trim();
}

// Detect if text looks like a citation marker
function isCitationText(text) {
  if (!text) return false;
  
  const canonical = canonicalizeMarkerText(text);
  
  // Numeric markers: 9, 12, 9a, 12b (1-3 digits optionally followed by 1 letter)
  if (/^\d{1,3}[a-zA-Z]?$/.test(canonical)) return true;
  
  // Note/ref markers: note 3, ref 7 (case-insensitive, optional space)
  if (/^(note|ref)\s*\d{1,3}$/i.test(canonical)) return true;
  
  // Citation needed marker
  if (/^citation\s+needed$/i.test(canonical)) return true;
  
  // Symbol markers: *, †, ‡, §
  if (/^[*†‡§]$/.test(canonical)) return true;
  
  return false;
}

// Normalize citation text to footnote label
function normalizeCitationLabel(text) {
  if (!text) return null;
  
  const canonical = canonicalizeMarkerText(text);
  
  // Numeric-like: 9, 12, 9a
  if (/^\d{1,3}[a-zA-Z]?$/.test(canonical)) {
    return canonical.toLowerCase();
  }
  
  // note/ref: note 3, ref 7 -> note3, ref7
  const noteMatch = canonical.match(/^(note|ref)\s*(\d{1,3})$/i);
  if (noteMatch) {
    return (noteMatch[1] + noteMatch[2]).toLowerCase();
  }
  
  // Citation needed -> citationneeded
  if (/^citation\s+needed$/i.test(canonical)) {
    return "citationneeded";
  }
  
  // Symbol markers: keep raw symbol so caller can decide fn#
  if (/^[*†‡§]$/.test(canonical)) {
    return canonical;
  }
  
  return null;
}

// Single-pass Markdown post-processor: linkify plain URLs and convert citations to footnotes
function postProcessMarkdown(markdown) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const urlRegex = /https?:\/\/[^\s\[\]]+/g;
  
  // Track footnote assignments and deduplication
  const urlToId = {};        // cleaned URL -> footnote ID
  const preferredIds = {};   // preferred ID -> { count, cleanedUrl }
  let autoGenCounter = 1;
  const footnotes = [];      // array of { id, url }
  
  let output = "";
  let lastIndex = 0;
  let match;
  
  // Use exec loop to find all Markdown links
  while ((match = linkRegex.exec(markdown)) !== null) {
    const linkText = match[1];
    const linkUrl = match[2];
    const linkStart = match.index;
    const linkEnd = match.index + match[0].length;
    
    // Process text segment before this link: linkify plain URLs
    const textSegment = markdown.substring(lastIndex, linkStart);
    output += linkifyPlainUrls(textSegment);
    
    // Process link token
    if (isCitationText(linkText)) {
      // Citation link: convert to footnote
      try {
        const absoluteUrl = makeAbsoluteFast(linkUrl);
        const cleanedUrl = cleanUrlFast(absoluteUrl);
        
        // Check if this URL already has a footnote ID
        if (urlToId[cleanedUrl]) {
          const footnoteId = urlToId[cleanedUrl];
          const beforeChar = output[output.length - 1];
          const needsSpace = beforeChar && /\w/.test(beforeChar);
          output += (needsSpace ? " " : "") + `[^${footnoteId}]`;
        } else {
          // Assign new footnote ID
          const preferredLabel = normalizeCitationLabel(linkText);
          let footnoteId;
          
          if (preferredLabel && /^[*†‡§]$/.test(preferredLabel)) {
            // Symbol: auto-generate [^fn1], [^fn2], ...
            footnoteId = `fn${autoGenCounter}`;
            autoGenCounter++;
          } else if (preferredLabel) {
            // Numeric or note/ref: use preferred label with collision handling
            if (!preferredIds[preferredLabel]) {
              preferredIds[preferredLabel] = { count: 0, urls: [] };
            }
            preferredIds[preferredLabel].urls.push(cleanedUrl);
            
            if (preferredIds[preferredLabel].count === 0) {
              footnoteId = preferredLabel;
            } else {
              footnoteId = preferredLabel + "-" + (preferredIds[preferredLabel].count + 1);
            }
            preferredIds[preferredLabel].count++;
          } else {
            // Ambiguous: auto-generate
            footnoteId = `fn${autoGenCounter}`;
            autoGenCounter++;
          }
          
          urlToId[cleanedUrl] = footnoteId;
          footnotes.push({ id: footnoteId, url: cleanedUrl });
          
          const beforeChar = output[output.length - 1];
          const needsSpace = beforeChar && /\w/.test(beforeChar);
          output += (needsSpace ? " " : "") + `[^${footnoteId}]`;
        }
      } catch (e) {
        // Fallback: keep as normal link
        output += match[0];
      }
    } else {
      // Normal link: keep unchanged
      output += match[0];
    }
    
    lastIndex = linkEnd;
  }
  
  // Process remaining text: linkify plain URLs
  if (lastIndex < markdown.length) {
    output += linkifyPlainUrls(markdown.substring(lastIndex));
  }
  
  // Append footnote definitions
  if (footnotes.length > 0) {
    output += "\n\n";
    for (const fn of footnotes) {
      output += `[^${fn.id}]: ${fn.url}\n`;
    }
  }
  
  return output;
}

// Helper: linkify plain URLs in a text segment
function linkifyPlainUrls(text) {
  if (!text.includes("http")) return text;
  
  let result = "";
  let lastIndex = 0;
  const urlRegex = /https?:\/\/[^\s\[\]]+/g;
  let match;
  
  while ((match = urlRegex.exec(text)) !== null) {
    // Add text before URL
    result += text.substring(lastIndex, match.index);
    
    // Process URL
    const urlString = match[0];
    const cleanedUrl = cleanUrlFast(urlString);
    const label = getSmartLabel(cleanedUrl);
    result += `[${label}](${cleanedUrl})`;
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  result += text.substring(lastIndex);
  return result;
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
  
  // Single-pass post-processing: linkify plain URLs and convert citations to footnotes
  md = postProcessMarkdown(md);
  
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
