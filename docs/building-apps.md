# Building WebDeck apps

A WebDeck app is a folder of static files (HTML, JS, CSS) plus a `webdeck.json` manifest.
It has **no backend of its own**. Storage, networking, files, notifications, background
checks and helper programs (yt-dlp, FFmpeg, Pandoc, LibreOffice) come from WebDeck through
`window.webdeck`, which is injected into every page.

That is what makes apps reliable: you never ship a database, a server, a port or a CORS setup.

```
my-app/
  webdeck.json     # required
  index.html       # entry page (any name, set "entry")
  app.js, *.css    # anything else you need
```

## webdeck.json

```json
{
  "id": "price-tracker",
  "name": "Price Tracker",
  "version": "1.0.0",
  "description": "Shown in the Store.",
  "category": "Trackers",
  "icon": "price",
  "color": "#10B981",
  "entry": "index.html",
  "permissions": ["net", "notify", "jobs"],
  "jobs": [{ "id": "check-prices", "title": "Check prices", "every": "4h" }],
  "platforms": ["macos", "windows", "linux"],
  "author": "You"
}
```

| Field | Notes |
| :--- | :--- |
| `id` | Lowercase letters, digits, `-`, `_`. Also the install folder and data folder name. |
| `version` | Dotted numbers. The Store offers an update when the catalog has a higher version. |
| `icon` | A built-in glyph: `app image photo video movie music download price chart ticket game gift doc pdf convert bell eye calendar note code tool globe cart rss`. |
| `color` | Icon tile color. |
| `permissions` | Any of `net`, `files`, `notify`, `jobs`, `tools`. Storage is always allowed. Users see these before installing. |
| `jobs` | Background checks. `every` is `30m`, `6h`, `1d`… (minimum 5 minutes). Optional `entry` (defaults to `index.html`). Requires `jobs`. |
| `platforms` | Omit for "everywhere". Apps that use `tools` should list desktop platforms only. |

## The SDK (`window.webdeck`)

All calls return promises. Errors carry a `code` (`permission_denied`, `bad_request`, `not_found`, `forbidden`, …).

### Storage (always available, private to your app)

```js
const items = webdeck.db.collection('items');
const doc = await items.insert({ url, price: 10 });          // adds _id, _createdAt, _updatedAt
await items.update(doc._id, { price: 8 });                   // merge
await items.find({ price: { $lte: 9 } }, { sort: '-price', limit: 20 });
await items.get(id); await items.remove(id); await items.removeWhere({ paused: true });

await webdeck.kv.set('seen', [1, 2, 3]);
const seen = await webdeck.kv.get('seen', []);               // with fallback
```

Query operators: equality, `$gt $gte $lt $lte $ne $in $contains`.

### Network: `net`

Server-side fetch, so there are no CORS limits. Local and loopback addresses are blocked.

```js
const res = await webdeck.net.fetch('https://example.com/api', { method: 'GET', headers: {}, timeout: 30 });
res.status; res.ok; res.text; res.json(); res.html(); // html() → parsed Document
```

### Files: `files`

```js
const [file] = await webdeck.files.pick({ type: 'image', multiple: false }); // or extensions: ['md','docx']
// file = { id, name, size, path, ext, url }  — `url` is same-origin, safe for <img> and canvas
const picked = await webdeck.files.upload(fileOrBlob);          // e.g. from drag & drop
const saved  = await webdeck.files.save({ name: 'out.png', blob }); // or { text } / { base64 }, optional subdir
await webdeck.files.reveal(saved.path); await webdeck.files.open(saved.path); await webdeck.files.openFolder();
```

Files are saved to `~/Downloads/WebDeck/<App Name>/`. Apps can only open or reveal their own files and files the user picked.

### Notifications: `notify`

```js
await webdeck.notify('Price drop', 'Now £49', { url: 'https://shop/item' });
```

They appear in **Activity**, and also as desktop notifications if enabled in Settings.

### Background jobs: `jobs`

WebDeck opens your job's entry page in a hidden WebView, with `?webdeck_job=<id>`. Check `webdeck.job.active` and do the work instead of drawing UI:

```js
if (webdeck.job.active) {
  webdeck.job.run(async () => {
    // ... fetch, compare, store, notify ...
    return 'Checked 3 items';            // summary shown in Activity → Background checks
  });
} else {
  startUi();
}
```

A run must finish within 3 minutes. Jobs run while WebDeck is open (macOS, iOS, Android).

### Helper tools: `tools` (desktop)

```js
const status = await webdeck.tools.status();      // { 'yt-dlp': {installed,...}, ffmpeg, pandoc, libreoffice, supported }
await webdeck.tools.install('yt-dlp', (p) => show(p.message));  // asks the user, then downloads
const task = await webdeck.tools.run('yt-dlp', ['-x', '--', url], {
  onLine: (line) => parseProgress(line),
  onStart: (t) => (current = t.id),             // webdeck.tools.cancel(current)
});
task.status;       // done | failed | cancelled
task.outputFiles;  // new files in the app's downloads folder (the tool's working directory)
```

Tools run in `~/Downloads/WebDeck/<App Name>/` without a shell. Options that would run other programs
(`--exec`, pandoc filters, …) are rejected. Put `--` before user-supplied URLs or paths.

### UI kit

Add `<link rel="stylesheet" href="/__webdeck/ui.css">` for WebDeck's look: `wd-app`, `wd-header`, `wd-card`,
`wd-btn` (`-primary`, `-sm`, `-ghost`, `-danger`), `wd-input`, `wd-select`, `wd-tabs`/`wd-tab`, `wd-chip`,
`wd-badge` (`-green`, `-red`, `-amber`, `-blue`), `wd-progress`, `wd-list`/`wd-item`, `wd-empty`, `wd-error`,
`wd-notice`, `wd-log`, `wd-drop`, `wd-table`, `wd-dialog`.
Helpers: `webdeck.ui.toast(msg, 'ok'|'error')`, `escape`, `formatBytes`, `timeAgo`. `webdeck.openUrl(url)` opens the system browser.

> The embedded WebView has no `alert()` / `confirm()` / `prompt()`. Use in-page UI instead.

## Publishing through a catalog

Built-in apps live in `assets/store/<id>/`. To add one, list the folder in `pubspec.yaml` and in `assets/store/catalog.json`.

To ship apps **without a WebDeck release**, host a catalog JSON (for example in a GitHub repo) and add its URL in **Settings → Store sources**:

```json
{
  "name": "My Apps",
  "apps": [
    {
      "id": "rss-reader", "name": "RSS Reader", "version": "1.0.0",
      "description": "…", "category": "Reading", "icon": "rss", "color": "#F97316",
      "permissions": ["net", "notify", "jobs"],
      "download": "https://github.com/you/webdeck-apps/releases/download/rss-reader-1.0.0/rss-reader.zip",
      "sha256": "<sha256 of the zip>"
    }
  ]
}
```

The zip contains the app folder (a single top-level directory is fine). `download` may be relative to the catalog URL.
Use `shasum -a 256 app.zip` to get the checksum. When provided, WebDeck verifies it before installing.

Updates keep the app's data. Uninstalling deletes the app and its data, but leaves files in Downloads.
