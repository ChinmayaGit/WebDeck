---
name: webdeck-extension
description: Build WebDeck extensions — small offline-first tools made of static HTML/CSS/JS plus a webdeck.json manifest, using the injected window.webdeck SDK for storage, network, files, notifications, background jobs, helper tools and Device Link. Use whenever someone asks for a WebDeck extension, a WebDeck app, or a tool to run inside WebDeck.
---

# Building a WebDeck extension

You are building an **extension** for WebDeck, a Flutter app that runs small web tools in an
embedded WebView on Android, iOS, macOS, Windows and Linux. An extension is a folder of
static files plus `webdeck.json`. There is no server, build step or framework requirement.

## How to work

1. **Clarify the requirement in one pass.** If the user only gave a one-line idea, pick
   sensible defaults and say what you assumed. Ask only when a choice changes the design
   (for example: which websites to track, or whether it needs background checks).
2. **Pick the smallest permission set.** Every permission is shown to the user before install.
   Never request `shell` unless running arbitrary commands *is* the extension's purpose.
3. **Write every file in full**, no placeholders and no "rest of the code here":
   - `webdeck.json` (valid JSON, fields documented below)
   - `index.html` (link `/__webdeck/ui.css`, use the `wd-*` classes)
   - `app.js` (wrap in an IIFE; `const wd = window.webdeck;`)
   - any extra `.css`/`.js` files
4. **Package it.** Tell the user to zip the folder (one top-level folder is fine) and install
   it in WebDeck: **Home → Add → Install web app**, or **Store → Build extension →
   Install from zip or folder**. Local use needs no approval.

## Hard rules

- No `alert()`, `confirm()` or `prompt()`; they don't exist in the WebView. Use in-page UI
  (`wd-dialog`, `webdeck.ui.toast`).
- No external CDNs at runtime unless the extension needs `net` anyway. Prefer the shared
  libraries in `/__webdeck/vendor/`. Extensions should work offline.
- Never use `fetch()` for cross-origin requests; use `webdeck.net.fetch` (requires `net`).
- Persist data with `webdeck.db` / `webdeck.kv`, not `localStorage` (localStorage is not
  backed up and is lost on reinstall).
- Escape all user or network text before inserting it as HTML (`webdeck.ui.escape`).
- Layout must work from 360px wide (phones) to desktop. No horizontal page scroll.
- `id` is permanent: changing it makes a different extension. Bump `version` on every
  change so WebDeck offers the update.
- Handle `permission_denied` and network errors with a visible message, never a blank page.

## Output checklist

Before finishing, confirm: manifest is valid JSON with `id`, `name`, `version`, `entry`;
every permission used in code is declared; every declared permission is used; the
extension renders something useful with no data; background jobs (if any) return a summary.

---

# WebDeck extension reference

