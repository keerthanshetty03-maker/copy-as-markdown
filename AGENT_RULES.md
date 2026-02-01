# Agent Rules for this Repo

Repo: MV3 Chrome extension "Copy as Markdown" (right-click → convert selection to Markdown → copy)

Rules:
- Make minimal changes only. Avoid refactors unless asked.
- Do not add permissions without explicitly calling it out.
- Do not add network calls (fetch/XHR/WebSocket).
- Keep Chrome Web Store compliance in mind.
- Always provide a 3–5 step test plan.
- If changing manifest.json, explain why and what reviewers will see.
- Always keep restricted pages blocked (chrome://, chromewebstore, etc.).
