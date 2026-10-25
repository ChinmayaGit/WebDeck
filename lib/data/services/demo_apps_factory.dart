import 'dart:convert';
import 'dart:typed_data';
import 'package:archive/archive.dart';

class DemoAppsFactory {
  /// Generates a complete static web app archive in-memory for testing and instant onboarding
  static Uint8List createArcadeDemoZip() {
    final archive = Archive();

    const manifestJson = '''{
  "name": "Neon Arcade 2048",
  "short_name": "NeonArcade",
  "version": "1.0.4",
  "description": "An offline, self-hosted retro arcade web experience running locally on WebDeck.",
  "start_url": "index.html",
  "icons": [
    {
      "src": "icon.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}''';

    const indexHtml = '''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Neon Arcade 2048</title>
  <style>
    :root {
      --bg: #0d1117;
      --card: #161b22;
      --accent: #58a6ff;
      --neon: #39d353;
      --text: #f0f6fc;
      --subtext: #8b949e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
      text-align: center;
    }
    .badge {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 12px;
      border: 1px solid rgba(88, 166, 255, 0.3);
    }
    h1 {
      font-size: 2.2rem;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #58a6ff, #bc8cff, #39d353);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: var(--subtext);
      margin-bottom: 24px;
      max-width: 440px;
      line-height: 1.5;
    }
    .game-box {
      background: var(--card);
      border: 1px solid #30363d;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
      width: 100%;
      max-width: 360px;
    }
    .score-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      font-size: 15px;
    }
    .score-val {
      font-weight: bold;
      color: var(--neon);
      font-size: 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: #21262d;
      padding: 10px;
      border-radius: 10px;
    }
    .tile {
      aspect-ratio: 1;
      background: #30363d;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 18px;
      transition: all 0.15s ease;
      user-select: none;
    }
    .tile.active {
      background: #1f6feb;
      color: white;
      box-shadow: 0 0 10px rgba(31, 111, 235, 0.6);
    }
    .btn {
      margin-top: 20px;
      background: #238636;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn:hover { background: #2ea043; }
    .status-pill {
      margin-top: 18px;
      font-size: 12px;
      color: var(--subtext);
    }
  </style>
</head>
<body>
  <div class="badge">WebDeck Sandboxed Loopback Runtime</div>
  <h1>Local Mini Arcade</h1>
  <p>This web application is served entirely from local device storage without internet access.</p>
  
  <div class="game-box">
    <div class="score-row">
      <div>SCORE: <span class="score-val" id="score">0</span></div>
      <div>HIGHSCORE: <span class="score-val" id="high">420</span></div>
    </div>
    <div class="grid" id="grid"></div>
    <button class="btn" onclick="tapGame()">Tap to Score</button>
    <div class="status-pill">Origin: <span id="origin"></span></div>
  </div>

  <script>
    document.getElementById('origin').innerText = window.location.origin;
    let score = 0;
    const grid = document.getElementById('grid');
    for (let i = 0; i < 16; i++) {
      const cell = document.createElement('div');
      cell.className = 'tile';
      cell.id = 'cell-' + i;
      grid.appendChild(cell);
    }
    function tapGame() {
      score += 10;
      document.getElementById('score').innerText = score;
      const rand = Math.floor(Math.random() * 16);
      const cell = document.getElementById('cell-' + rand);
      cell.classList.add('active');
      cell.innerText = '⚡';
      setTimeout(() => {
        cell.classList.remove('active');
        cell.innerText = '';
      }, 350);
    }
  </script>
</body>
</html>''';

    // 1x1 transparent PNG fallback for icon.png
    final iconBytes = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    );

    final manifestBytes = utf8.encode(manifestJson);
    final htmlBytes = utf8.encode(indexHtml);

    archive.addFile(ArchiveFile('webdeck.json', manifestBytes.length, manifestBytes));
    archive.addFile(ArchiveFile('index.html', htmlBytes.length, htmlBytes));
    archive.addFile(ArchiveFile('icon.png', iconBytes.length, iconBytes));

    return Uint8List.fromList(ZipEncoder().encode(archive));
  }
}
