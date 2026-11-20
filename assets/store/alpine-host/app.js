(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('hosted_apps');

  let logs = [
    'Welcome to Alpine Linux v3.19 (WebDeck Cloud & Container Runner)',
    'Kernel 6.6.14-0-virt on x86_64 / WebAssembly WasmVM',
    'Rootfs mounted rw, sysfs initialized.',
    'Default gateway 172.17.0.1 online. DNS resolved.',
    'Type "apk add <package>" or "help" for common server commands.\n'
  ];

  let hostedApps = [
    {
      id: 'app-web-portal',
      name: 'Python Static Web Server',
      command: 'python3 -m http.server 8080 --bind 0.0.0.0',
      port: 8080,
      status: 'live',
      url: 'http://localhost:8080',
      uptime: '2 hours 14 mins'
    },
    {
      id: 'app-api-mock',
      name: 'Node.js Microservice API',
      command: 'node server.js --port 3000',
      port: 3000,
      status: 'live',
      url: 'http://localhost:3000',
      uptime: '45 mins'
    },
    {
      id: 'app-sqlite-db',
      name: 'PocketBase / SQLite Live Backend',
      command: './pocketbase serve --http="0.0.0.0:8090"',
      port: 8090,
      status: 'live',
      url: 'http://localhost:8090',
      uptime: '1 day'
    }
  ];

  function init() {
    renderTerminal();
    renderHostedApps();
    bindEvents();
  }

  function bindEvents() {
    $('termForm').onsubmit = (e) => {
      e.preventDefault();
      const cmd = $('termInput').value.trim();
      if (!cmd) return;
      $('termInput').value = '';
      executeCommand(cmd);
    };

    $('btnDeployApp').onclick = () => {
      const name = prompt('Enter App Name (e.g. My Express API or Static Website):');
      if (!name) return;
      const port = parseInt(prompt('Port to expose (e.g. 5000):', '5000'), 10) || 5000;
      const cmd = prompt('Start Command:', `python3 -m http.server ${port}`);
      
      const newApp = {
        id: 'app-' + Date.now(),
        name,
        command: cmd,
        port,
        status: 'live',
        url: `http://localhost:${port}`,
        uptime: 'Just started'
      };
      hostedApps.unshift(newApp);
      logs.push(`alpine:# ${cmd}`);
      logs.push(`[+] Started container background service "${name}" on port ${port}`);
      logs.push(`[+] Live HTTP endpoint ready at http://0.0.0.0:${port}\n`);
      renderTerminal();
      renderHostedApps();
      wd.ui.toast(`Hosted live app "${name}" on port ${port}`, 'ok');
    };

    $('btnRestartAlpine').onclick = () => {
      logs = [
        '--- Restarting Alpine Linux Sandbox ---',
        'Unmounting volumes… OK',
        'Initializing Alpine v3.19 rootfs…',
        'Kernel 6.6.14-0-virt started.',
        'Networking loopback and eth0 configured 172.17.0.2/16.',
        'Ready.\n'
      ];
      renderTerminal();
      wd.ui.toast('Alpine Linux environment rebooted', 'ok');
    };
  }

  function renderTerminal() {
    $('termLogs').textContent = logs.join('\n');
    $('termLogs').scrollTop = $('termLogs').scrollHeight;
  }

  function executeCommand(cmd) {
    logs.push(`alpine:# ${cmd}`);
    const lower = cmd.toLowerCase();

    if (lower === 'help') {
      logs.push('Available Alpine Utilities:\n  apk add <pkg>  : Install Alpine packages (e.g. python3, nodejs, curl, git, sqlite)\n  python3 -m http.server <port> : Run Python live web server\n  uname -a       : Show system architecture and kernel info\n  ps aux         : List active running background processes\n  df -h          : Show disk space and memory utilization\n  clear          : Clear terminal screen\n');
    } else if (lower.startsWith('apk add') || lower.startsWith('apk update')) {
      const pkg = cmd.replace(/^apk\s+add\s+/i, '').trim();
      logs.push(`fetch https://dl-cdn.alpinelinux.org/alpine/v3.19/main/x86_64/APKINDEX.tar.gz`);
      logs.push(`fetch https://dl-cdn.alpinelinux.org/alpine/v3.19/community/x86_64/APKINDEX.tar.gz`);
      logs.push(`(1/2) Installing ${pkg || 'packages'}...`);
      logs.push(`(2/2) Updating system dependencies and symlinks...`);
      logs.push(`OK: 14 distinct packages installed in 42MB, 0 errors.\n`);
    } else if (lower === 'uname -a') {
      logs.push('Linux alpine-live-host 6.6.14-0-virt #1-Alpine SMP PREEMPT_DYNAMIC x86_64 Linux\n');
    } else if (lower === 'ps aux' || lower === 'ps') {
      logs.push('PID   USER     TIME  COMMAND');
      logs.push('    1 root      0:01 /sbin/init');
      logs.push('   24 root      0:00 /bin/ash');
      hostedApps.forEach((a, i) => {
        logs.push(`  ${100 + i * 14} root      0:0${i+1} ${a.command}`);
      });
      logs.push('');
    } else if (lower === 'clear') {
      logs = [];
    } else if (lower === 'uptime') {
      logs.push('up 4 days, 12 hours, load average: 0.12, 0.08, 0.04\n');
    } else if (lower.includes('http.server') || lower.includes('node') || lower.includes('serve')) {
      const portMatch = cmd.match(/(\d{4,5})/);
      const port = portMatch ? parseInt(portMatch[1], 10) : 8080;
      hostedApps.push({
        id: 'app-' + Date.now(),
        name: 'Live Process (' + cmd.split(' ')[0] + ')',
        command: cmd,
        port,
        status: 'live',
        url: `http://localhost:${port}`,
        uptime: 'Just started'
      });
      logs.push(`Serving HTTP on 0.0.0.0 port ${port} (http://0.0.0.0:${port}/) ...`);
      logs.push(`[+] Service bound and listening.\n`);
      renderHostedApps();
    } else {
      logs.push(`alpine: command processed: ${cmd}\n`);
    }

    renderTerminal();
  }

  function renderHostedApps() {
    $('liveAppsCount').textContent = `${hostedApps.length} app${hostedApps.length === 1 ? '' : 's'} online`;

    $('appsGrid').innerHTML = hostedApps.map(a => `
      <div class="app-host-card">
        <div class="wd-row">
          <span class="status-dot ${a.status === 'live' ? 'dot-live' : 'dot-off'}"></span>
          <span style="font-weight:700;font-size:14px">${esc(a.name)}</span>
          <div class="wd-spacer"></div>
          <span class="wd-small" style="color:#10B981;font-weight:700">Port :${a.port}</span>
        </div>
        <div class="wd-small" style="font-family:monospace;background:var(--wd-surface-2);padding:6px 8px;border-radius:6px;word-break:break-all">
          ${esc(a.command)}
        </div>
        <div class="wd-small wd-muted">Uptime: ${esc(a.uptime)}</div>
        <div class="wd-row" style="margin-top:auto;gap:6px">
          <button class="wd-btn wd-btn-primary wd-btn-sm" data-preview-url="${esc(a.url)}">🌐 Open Preview</button>
          <div class="wd-spacer"></div>
          <button class="wd-btn wd-btn-ghost wd-btn-sm" data-stop-app="${esc(a.id)}" style="color:#ef4444">Stop</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-preview-url]').forEach(btn => {
      btn.onclick = () => {
        wd.openUrl(btn.dataset.previewUrl);
      };
    });

    document.querySelectorAll('[data-stop-app]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.stopApp;
        hostedApps = hostedApps.filter(x => x.id !== id);
        renderHostedApps();
        wd.ui.toast('Service stopped', 'ok');
      };
    });
  }

  init();
})();
