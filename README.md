# WebDeck

**WebDeck** is a cross-platform local app launcher and store for modern web apps — like Steam / SideQuest / F-Droid, but for React, Angular, Vue, Flutter Web, Svelte, Next.js static exports, HTML5/WASM games, and full-stack local projects (Python, Node, .NET, Vite, SQL/NoSQL).

It installs apps from GitHub, zip URLs, or a local folder, then runs them on a loopback server inside an embedded WebView — with companion backend startup, API health checks, and a built-in **Database Studio**.

---

## What it does

| Capability | Description |
| :--- | :--- |
| **Install web apps** | From GitHub releases/branches, direct `.zip` URLs, or local sideload |
| **Serve correctly** | SPA history fallback, WASM MIME types, CORS, persistent ports (keeps LocalStorage / IndexedDB) |
| **Companion backends** | Detects and starts Python, Node, .NET (`dotnet run`), and Vite (`npm run dev`) |
| **API checks** | Waits for ports and probes health URLs before launch |
| **Backend Console** | Start/stop companions, test APIs, open Database Studio |
| **Database Studio** | Browse/edit SQL & NoSQL/API data: grid Add/Edit/Delete + query editor |
| **In-app player** | Native WebView with reload, external browser, and backend tools |

---

## Supported frontends

| Framework | Challenge | WebDeck handling |
| :--- | :--- | :--- |
| **React / Vite / CRA** | Client routes 404 on refresh | SPA fallback → `index.html` |
| **Angular** | Needs correct web root / base href | Mounts folder that contains `index.html` |
| **Flutter Web** | `build/web`, WASM MIME | Auto-detect + `application/wasm` |
| **Vue / Svelte** | ES modules / chunks | Correct MIME + CORS |
| **Next.js (export)** | `out/` static export | Static serve + clean URLs |
| **HTML5 / WASM** | Cross-origin / isolation | Loopback CORS + CORP headers |

Unbuilt Vite apps (source `index.html` pointing at `/src/main.tsx`) are **not** served as static files. WebDeck starts `node node_modules/vite/bin/vite.js` and opens the Vite URL instead.

---

## Companion backends & databases

On launch, WebDeck inspects the installed bundle and can start:

- **Python** — `serve.py` / `app.py` / `server.py` / …
- **Node** — project `server.js` / `backend.js` (ignores `node_modules`)
- **.NET** — `*.csproj` via `dotnet run` (patches local CORS for Vite origins)
- **Vite UI** — `npm`/`vite` dev server when no compiled `dist` exists

**Database Studio** engines (auto-detected per app):

| Engine | When used | Features |
| :--- | :--- | :--- |
| **SQLite** | `.db` / `.sqlite` files in the app | SQL editor + grid CRUD |
| **SQL Server / Postgres / MySQL** | Connection strings + CLI (`sqlcmd` / `psql` / `mysql`) | Query + CRUD via CLI |
| **MongoDB** | `mongodb://` + `mongosh` | Filter/script + document CRUD |
| **REST / API store** | Detected API URLs (e.g. `/api/employees`) | JSON grid + POST/PUT/DELETE |

You can switch engines in the Studio header when more than one store is available.

---

## Architecture

```
GitHub / Zip URL / Local folder
            │
            ▼
   Install into sandboxed apps/<id>/
            │
            ▼
   Inspect web root + backend requirements
            │
            ▼
   Catalog (launch / browser / backend console)
            │
     ┌──────┴──────┐
     ▼             ▼
 Loopback HTTP   Companion processes
 (static/SPA)    (.NET / Python / Node / Vite)
     │             │
     └──────┬──────┘
            ▼
   Embedded WebView + Database Studio
```

---

## Install apps

1. **GitHub** — `owner/repo` or full GitHub URL (release asset or branch archive).
2. **Direct zip** — any `.zip` URL.
3. **Local sideload** — Install App → pick a `dist/`, `build/web/`, `out/`, or full project folder.
4. **Quick Demo** — built-in Neon Arcade 2048.

---

## How to use (day to day)

1. Install an app from GitHub or local folder.
2. Click **Launch**.
3. If a backend is required, WebDeck **auto-starts** it (or shows the setup dialog).
4. Use the player overlay:
   - Reload / Open in browser
   - **Backend Console** (DNS icon) → start/stop, **Test API**, **Open Database**
5. In **Database Studio**: pick a connection, select a table/collection, Add/Edit/Delete rows, or run SQL/queries.

**Example:** EMPManagement  
- Vite UI on port `5173`  
- .NET API on port `5018`  
- SQLite file at `EmployeeApi/Data/employees.db`  
- Studio can edit either the SQLite file or the live REST collection.

---

## Develop

```bash
flutter pub get
flutter test
flutter run -d macos          # or chrome / android / ios
```

---

## Release builds

### One-shot script (macOS host)

```bash
chmod +x scripts/build_releases.sh
./scripts/build_releases.sh
```

Artifacts land in [`releases/`](releases/):

| File | Platform |
| :--- | :--- |
| `WebDeck-macos-arm64.zip` | macOS (Apple Silicon `.app`) |
| `WebDeck-android-release.apk` | Android sideload |
| `WebDeck-android-release.aab` | Google Play bundle |
| `WebDeck-ios-unsigned.zip` | iOS `Runner.app` (**unsigned** — sign in Xcode) |
| `Windows-build-instructions.txt` | How to build on Windows |

### Manual commands

```bash
# macOS
flutter build macos --release

# Android
flutter build apk --release
flutter build appbundle --release

# iOS (device/App Store need signing in Xcode)
flutter build ios --release --no-codesign

# Windows (run on a Windows machine)
flutter build windows --release
```

### Platform notes

- **macOS** — Open `webdeck.app` (or the zip under `releases/`). Gatekeeper may require right-click → Open the first time.
- **Android** — Install the APK, or upload the AAB to Play Console.
- **iOS** — Open `ios/Runner.xcworkspace` in Xcode, set your Team/signing, then archive or install to a device. The zip is an unsigned build product for CI/packaging.
- **Windows** — Flutter does not cross-compile Windows from macOS. Build on Windows and zip `build/windows/x64/runner/Release/`.

---

## Project layout

```
lib/
  data/
    db/                 # Database Studio engines (SQLite, SQL CLI, Mongo, REST)
    models/             # InstalledApp, BackendRequirement, …
    repositories/       # Install / launch / companions
    services/           # Loopback server, GitHub, archive inspect
  ui/
    features/catalog/   # Home, install, setup, backend console, DB studio
    features/player/    # In-app WebView
releases/               # Packaged release binaries (see build script)
scripts/build_releases.sh
```

---

## Tests

```bash
flutter test
```

Coverage includes SPA serving, Python/SQLite companion detection, Vite `node_modules` false-positive ignores, and .NET / Vite / SQL Server-style detection.

---

## License / credit

Fan tooling for local web apps. Ship only software you have rights to distribute. Mario / third-party game assets remain property of their owners.
