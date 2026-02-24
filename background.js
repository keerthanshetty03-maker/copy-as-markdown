const MENU_ID = "copy_as_markdown";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Copy as Markdown",
    contexts: ["selection"]
  });
});

function isRestrictedUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    // allow only http and https pages
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    const host = (u.hostname || "").toLowerCase();
    // block common extension/webstore hosts
    if (
      host === "chrome.google.com" ||
      host.endsWith(".chrome.google.com") ||
      host === "chromewebstore.google.com" ||
      host === "addons.mozilla.org"
    ) {
      return true;
    }
    return false;
  } catch (e) {
    // non-parseable URLs (about:, chrome:, etc.) considered restricted
    return true;
  }
}

// Reusable helper to trigger the copy action for a given tab
async function triggerCopyForTab(tab) {
  if (!tab?.id) return;
  if (isRestrictedUrl(tab.url)) {
    console.warn("Copy as Markdown blocked on restricted page:", tab.url);
    return;
  }
  try {
    // Inject only when the user clicks (least privilege)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["turndown.js", "content.js"]
    });

    // Send message to injected content script
    const res = await chrome.tabs.sendMessage(tab.id, { type: "COPY_SELECTION_AS_MD" });
    if (!res?.ok) console.warn("Copy as Markdown failed:", res?.error);
  } catch (e) {
    console.warn("Copy as Markdown injection/message failed:", e);
  }
}

// Context menu reuses the same helper
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  await triggerCopyForTab(tab);
});

// Keyboard command handler (Cmd/Ctrl+Shift+C)
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "copy-as-markdown") return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  await triggerCopyForTab(tabs[0]);
});
