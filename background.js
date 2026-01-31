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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!tab?.id) return;

  if (isRestrictedUrl(tab.url)) {
    console.warn("Copy as Markdown: blocked on restricted page:", tab.url);
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "COPY_SELECTION_AS_MD" });
    if (!res?.ok) console.warn("Copy as Markdown failed:", res?.error);
  } catch (e) {
    console.warn("Error sending message:", e);
  }
});
