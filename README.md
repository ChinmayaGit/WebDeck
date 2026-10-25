# WebDeck: Universal Local Web App Launcher & Store

**WebDeck** is a cross-platform App Launcher and Local App Store (similar to Steam or SideQuest / F-Droid, but engineered for modern web apps). It runs **any web application locally** — including **React, Angular, Vue, Flutter Web, Svelte, Next.js static export, and HTML5/WASM** — without requiring external hosting or cloud servers.

---

## 🌟 Universal Web Support

Web applications built with modern frameworks have specific runtime needs that traditional file viewers break:

| Framework | Challenge on Localhost / File System | WebDeck Solution |
| :--- | :--- | :--- |
| **React / Vite / CRA** | Client-side routing (`/dashboard`, `/profile`) throws 404 on refresh | **SPA History API Fallback**: automatically routes unhandled GET requests to `index.html` with status 200 |
| **Angular** | Requires `<base href="/">` and deep route rewriting | Server root dynamically mounts right where `index.html` lives (`dist/<app>/browser` or `dist/`) |
| **Flutter Web** | Requires nested `build/web/` root, WASM MIME types, and CanvasKit/Skwasm | Auto-detects `flutter.js`, maps `application/wasm`, `text/javascript`, and fonts |
| **Vue / Svelte** | Modern ES module imports (`.mjs`, chunk splitting) | Standard MIME type mapping and unrestricted CORS headers |
| **Next.js (Export)** | Static HTML export (`out/`) | Automatic directory indexing and clean URL routing |
| **HTML5 / WASM Games** | Needs `SharedArrayBuffer` & cross-origin isolation | Injects `Cross-Origin-Resource-Policy: cross-origin` and open loopback CORS |

---

## 🏛️ Architecture Overview

```
[ User pastes GitHub Link / Release URL / Picks Local Build Folder / Zip ]
                                   │
                                   ▼
[ Resolver: Fetches Release (.zip), Branch Archive, or copies Local Dir ]
                                   │
                                   ▼
[ Archive Extractor: Unzips safely to Sandboxed Storage (/apps/<app-id>/) ]
                                   │
                                   ▼
[ Web Root & Framework Inspector: Locates dist/ or build/web/ & detects type ]
                                   │
                                   ▼
[ Launcher Catalog UI: Displays Framework Badge, Version, Size & Controls ]
                                   │
                                   ▼ (User clicks Launch)
[ Embedded Loopback Server: Binds to 127.0.0.1:<random-port> with SPA fallback ]
                                   │
                                   ▼
[ Local Webview Runtime: Loads loopback URL with navigation toolbar ]
```

---

## 🚀 Ways to Install Any App

1. **GitHub Releases**:
   - Paste any repo with a compiled release: `owner/repo` or `https://github.com/owner/repo`.
   - WebDeck automatically inspects release assets and picks the static bundle (`dist.zip`, `build.zip`, `web.zip`, etc.).

2. **GitHub Branch Archive (No Release Required)**:
   - Paste any repo containing static HTML/JS or build files on its default branch (e.g., `ChinmayaGit/PlayStorePurchaseTracker`).
   - WebDeck falls back to downloading the branch archive automatically.

3. **Direct Zip / Tarball URL**:
   - Paste any link ending in `.zip` (e.g., `https://example.com/my-game-v1.zip`).

4. **Local Sideloading (Pick Folder or Zip)**:
   - Click **Install App** -> **Local Sideload**.
   - Select your local `dist/`, `build/web/`, or `out/` folder directly from your computer with 1 click.
   - Ideal for developers testing their own React, Angular, or Flutter builds offline.

5. **Instant Built-In Demo**:
   - Click **Quick Demo** to unpack and launch the included offline retro arcade game (`Neon Arcade 2048`).

---

## 🛠️ Running Locally

```bash
# Get dependencies
flutter pub get

# Run all test suites
flutter test

# Run WebDeck
flutter run
```
# WebDeck
