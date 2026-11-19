/*
 * WebDeck Runtime SDK — injected into every runtime app as window.webdeck.
 * Apps are static HTML/JS; WebDeck provides storage, network, files,
 * notifications, background jobs and helper tools through this API.
 * Docs: docs/building-apps.md
 */
(function () {
  'use strict';
  if (window.webdeck) return;

  const API = '/__webdeck/api';

  async function call(method, params) {
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WebDeck': '1' },
        body: JSON.stringify({ method, params: params || {} }),
      });
    } catch (e) {
      const err = new Error('WebDeck runtime is not reachable: ' + e.message);
      err.code = 'unreachable';
      throw err;
    }
    let body;
    try {
      body = await res.json();
    } catch (_) {
      const err = new Error('Invalid response from WebDeck runtime (' + res.status + ')');
      err.code = 'internal';
      throw err;
    }
    if (!body.ok) {
      const err = new Error(body.error || 'WebDeck call failed');
      err.code = body.code;
      throw err;
    }
    return body.result;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function collection(name) {
    return {
      find: (where, opts) => call('db.find', Object.assign({ collection: name, where: where || null }, opts || {})),
      get: (id) => call('db.get', { collection: name, id }),
      insert: (doc) => call('db.insert', { collection: name, doc }),
      update: (id, patch) => call('db.update', { collection: name, id, patch }),
      remove: (id) => call('db.remove', { collection: name, id }),
      removeWhere: (where) => call('db.removeWhere', { collection: name, where: where || null }),
      clear: () => call('db.removeWhere', { collection: name, where: null }),
    };
  }

  function wrapResponse(r) {
    r.json = () => JSON.parse(r.text);
    r.html = () => new DOMParser().parseFromString(r.text || '', 'text/html');
    return r;
  }

  const qs = new URLSearchParams(location.search);
  const jobId = qs.get('webdeck_job');
  const runId = qs.get('webdeck_run');

  const webdeck = {
    version: '1.0.0',
    call,

    app: {
      info: () => call('app.info'),
    },

    /** Document storage scoped to this app. webdeck.db.collection('items').insert({...}) */
    db: {
      collection,
      collections: () => call('db.collections'),
    },

    /** Simple key/value storage scoped to this app. */
    kv: {
      get: (key, fallback) => call('kv.get', { key }).then((v) => (v === null || v === undefined ? fallback : v)),
      set: (key, value) => call('kv.set', { key, value }),
      remove: (key) => call('kv.set', { key, value: null }),
      all: () => call('kv.all'),
    },

    /** Server-side fetch without CORS limits. Requires "net". */
    net: {
      fetch: (url, opts) => call('net.fetch', Object.assign({ url }, opts || {})).then(wrapResponse),
    },

    /** Requires "files". */
    files: {
      /** Native picker. Returns [{id, name, size, path, ext, url}] — url is same-origin, safe for <img>/canvas. */
      pick: (opts) => call('files.pick', opts || {}),
      /** Registers a File/Blob (e.g. from drag & drop) with the host; returns the same shape as pick(). */
      upload: async (file) => {
        const res = await fetch('/__webdeck/upload?name=' + encodeURIComponent(file.name || 'file'), {
          method: 'POST',
          headers: { 'X-WebDeck': '1' },
          body: file,
        });
        const body = await res.json();
        if (!body.ok) throw Object.assign(new Error(body.error), { code: body.code });
        return body.result;
      },
      /** Save to ~/Downloads/WebDeck/<App>/ — pass {name, text} or {name, base64 | blob}. */
      save: async (opts) => {
        if (opts && opts.blob instanceof Blob) {
          const b64 = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(opts.blob);
          });
          opts = Object.assign({}, opts, { base64: b64 });
          delete opts.blob;
        }
        return call('files.save', opts);
      },
      reveal: (path) => call('files.reveal', { path }),
      open: (path) => call('files.open', { path }),
      openFolder: () => call('files.openFolder'),
      downloadsDir: () => call('files.downloadsDir'),
    },

    /** Requires "notify". */
    notify: (title, body, opts) => call('notify', Object.assign({ title, body: body || '' }, opts || {})),

    /** Opens an http(s) link in the system browser. */
    openUrl: (url) => call('system.openUrl', { url }),

    /** Helper programs (yt-dlp, ffmpeg, pandoc, libreoffice). Requires "tools". Desktop only. */
    tools: {
      status: (opts) => call('tools.status', opts || {}),
      /** Asks the user, then downloads the tool in the background. Resolves when installed. */
      install: async (tool, onProgress) => {
        await call('tools.install', { tool });
        for (;;) {
          await sleep(700);
          const s = await call('tools.status');
          const t = s[tool];
          if (t && t.installing) {
            if (onProgress) onProgress(t.installing);
            continue;
          }
          if (t && t.installed) return t;
          throw new Error('Installing ' + tool + ' failed — see WebDeck notifications.');
        }
      },
      /**
       * Runs a tool in this app's downloads folder. Streams output lines to opts.onLine.
       * Resolves with {status, exitCode, outputFiles, lines}. opts.onStart receives the task (for cancel()).
       */
      run: async (tool, args, opts) => {
        opts = opts || {};
        let task = await call('tools.run', { tool, args: args || [] });
        if (opts.onStart) opts.onStart(task);
        let cursor = 0;
        const all = [];
        for (;;) {
          task = await call('tasks.get', { id: task.id, since: cursor });
          cursor = task.cursor;
          for (const line of task.lines) {
            all.push(line);
            if (opts.onLine) opts.onLine(line);
          }
          if (task.status !== 'running') break;
          await sleep(opts.pollMs || 400);
        }
        if (all.length > 400) all.splice(0, all.length - 400);
        task.lines = all;
        return task;
      },
      cancel: (taskId) => call('tasks.cancel', { id: taskId }),
    },

    /** Background jobs declared in webdeck.json. Requires "jobs". */
    jobs: {
      list: () => call('jobs.list'),
      run: (id) => call('jobs.run', { id }),
    },

    /**
     * Present when this page was opened by the scheduler to run a job.
     * Do the work, then call webdeck.job.done('summary') (or fail(error)).
     */
    job: {
      active: !!(jobId && runId),
      id: jobId,
      runId,
      done: (summary) => call('job.done', { runId, summary: summary == null ? '' : String(summary) }),
      fail: (error) => call('job.fail', { runId, error: String(error && error.message ? error.message : error) }),
      log: (message) => call('job.log', { runId, message: String(message) }),
      /** Runs fn, then reports done/fail automatically. */
      run: async (fn) => {
        try {
          const summary = await fn();
          await webdeck.job.done(summary);
        } catch (e) {
          await webdeck.job.fail(e);
        }
      },
    },

    /** Small UI helpers shared by apps. */
    ui: {
      toast(message, kind) {
        let host = document.getElementById('wd-toasts');
        if (!host) {
          host = document.createElement('div');
          host.id = 'wd-toasts';
          host.className = 'wd-toasts';
          document.body.appendChild(host);
        }
        const el = document.createElement('div');
        el.className = 'wd-toast' + (kind ? ' wd-toast-' + kind : '');
        el.textContent = message;
        host.appendChild(el);
        setTimeout(() => el.classList.add('wd-toast-out'), 3200);
        setTimeout(() => el.remove(), 3700);
      },
      escape(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      },
      formatBytes(n) {
        if (!n && n !== 0) return '';
        const u = ['B', 'KB', 'MB', 'GB'];
        let i = 0;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (i ? n.toFixed(1) : n) + ' ' + u[i];
      },
      timeAgo(iso) {
        if (!iso) return 'never';
        const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
        if (s < 60) return 'just now';
        if (s < 3600) return Math.round(s / 60) + 'm ago';
        if (s < 86400) return Math.round(s / 3600) + 'h ago';
        return Math.round(s / 86400) + 'd ago';
      },
    },
  };

  window.webdeck = webdeck;
  window.dispatchEvent(new Event('webdeck:ready'));
})();
