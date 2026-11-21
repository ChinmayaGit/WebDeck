(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;

  const PLATFORMS = [['all', 'All'], ['windows', 'Windows'], ['mac', 'Mac'], ['linux', 'Linux'], ['android', 'Android'], ['ios', 'iPhone & iPad']];
  const ALL = ['windows', 'mac', 'linux', 'android', 'ios'];
  const DESKTOP = ['windows', 'mac', 'linux'];
  const COUNTRIES = { in: 'India', us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', jp: 'Japan', br: 'Brazil', ae: 'UAE', sg: 'Singapore' };

  // Where paid apps go free for a limited time.
  const DEALS = [
    { name: 'r/googleplaydeals', p: ['android'], c: '#FF4500', i: 'r/', desc: 'Paid Play Store apps and games that are free or discounted right now, posted daily.', url: 'https://www.reddit.com/r/googleplaydeals/' },
    { name: 'r/AppHookup', p: ['ios', 'android', 'mac'], c: '#FF4500', i: 'r/', desc: 'iOS, Android and Mac apps on sale or free for a limited time.', url: 'https://www.reddit.com/r/AppHookup/' },
    { name: 'r/macapps', p: ['mac'], c: '#FF4500', i: 'r/', desc: 'Mac app launches, free versions and deals from developers.', url: 'https://www.reddit.com/r/macapps/' },
    { name: 'r/androidapps', p: ['android'], c: '#FF4500', i: 'r/', desc: 'Android app recommendations, including free and promo-code giveaways.', url: 'https://www.reddit.com/r/androidapps/' },
    { name: 'r/iosapps', p: ['ios'], c: '#FF4500', i: 'r/', desc: 'iPhone and iPad app discoveries and developer promo codes.', url: 'https://www.reddit.com/r/iosapps/' },
    { name: 'r/software', p: DESKTOP, c: '#FF4500', i: 'r/', desc: 'Desktop software recommendations and free alternatives.', url: 'https://www.reddit.com/r/software/' },
    { name: '@AppStoreDeals on Telegram', p: ['ios', 'mac'], c: '#229ED9', i: '✈', desc: 'Paid iPhone, iPad and Mac apps and in-app unlocks that just went free.', url: 'https://t.me/AppStoreDeals' },
    { name: 'Giveaway of the Day', p: ['windows'], c: '#0EA5E9', i: '🎁', desc: 'A paid Windows program free every day (licensed giveaway, install within the day).', url: 'https://www.giveawayoftheday.com/' },
    { name: 'SharewareOnSale', p: ['windows', 'mac'], c: '#2563EB', i: '💲', desc: 'Free licenses and deep discounts on paid Windows and Mac software.', url: 'https://sharewareonsale.com/' },
    { name: 'AppSliced', p: ['ios', 'mac'], c: '#7C3AED', i: '📉', desc: 'Tracks App Store price drops; filter for apps that just went free.', url: 'https://appsliced.co/' },
    { name: 'AlternativeTo', p: ALL, c: '#0F766E', i: '⇄', desc: 'Find free alternatives to any paid app, on any platform.', url: 'https://alternativeto.net/' },
  ];

  // Hand-picked free, open-source apps.
  const OSS = [
    ['VLC', ALL, 'Plays any video or audio file and stream.', 'https://www.videolan.org/vlc/', '#FF8800', '▶'],
    ['LibreOffice', DESKTOP, 'Full office suite: documents, spreadsheets, slides.', 'https://www.libreoffice.org/', '#18A303', 'L'],
    ['GIMP', DESKTOP, 'Photo editing and image manipulation.', 'https://www.gimp.org/', '#5C5543', 'G'],
    ['Krita', [...DESKTOP, 'android'], 'Digital painting and illustration.', 'https://krita.org/', '#3BABFF', 'K'],
    ['Inkscape', DESKTOP, 'Vector graphics, logos and illustrations.', 'https://inkscape.org/', '#000000', 'I'],
    ['Blender', DESKTOP, '3D modelling, animation and video editing.', 'https://www.blender.org/', '#EA7600', 'B'],
    ['Audacity', DESKTOP, 'Record and edit audio.', 'https://www.audacityteam.org/', '#0000CC', 'A'],
    ['OBS Studio', DESKTOP, 'Screen recording and live streaming.', 'https://obsproject.com/', '#302E31', '●'],
    ['Shotcut', DESKTOP, 'Video editor with 4K support.', 'https://shotcut.org/', '#115C9C', 'S'],
    ['HandBrake', DESKTOP, 'Convert and compress videos.', 'https://handbrake.fr/', '#C0392B', 'H'],
    ['Firefox', ALL, 'Private, fast web browser.', 'https://www.mozilla.org/firefox/', '#FF7139', 'F'],
    ['Thunderbird', [...DESKTOP, 'android'], 'Email, calendar and contacts.', 'https://www.thunderbird.net/', '#0A84FF', 'T'],
    ['Bitwarden', ALL, 'Password manager that syncs everywhere.', 'https://bitwarden.com/download/', '#175DDC', '🛡'],
    ['KeePassXC', DESKTOP, 'Offline password manager.', 'https://keepassxc.org/', '#6CAC4D', 'K'],
    ['Signal', ALL, 'End-to-end encrypted messaging and calls.', 'https://signal.org/download/', '#3A76F0', 'S'],
    ['Joplin', ALL, 'Notes and to-dos with sync and Markdown.', 'https://joplinapp.org/', '#1071D3', 'J'],
    ['LocalSend', ALL, 'Send files to nearby devices without the internet.', 'https://localsend.org/', '#008080', '⇆'],
    ['Syncthing', [...DESKTOP, 'android'], 'Sync folders between your devices, no cloud.', 'https://syncthing.net/', '#0891D1', '⟳'],
    ['VSCodium', DESKTOP, 'Code editor (VS Code without telemetry).', 'https://vscodium.com/', '#2F80ED', '{}'],
    ['7-Zip', ['windows'], 'Open and create ZIP, RAR, 7z archives.', 'https://www.7-zip.org/', '#000000', '7z'],
    ['ShareX', ['windows'], 'Screenshots, screen recording and sharing.', 'https://getsharex.com/', '#2E7DD7', '📷'],
    ['Rectangle', ['mac'], 'Snap and arrange windows with shortcuts.', 'https://rectangleapp.com/', '#5856D6', '▦'],
    ['IINA', ['mac'], 'Modern media player for macOS.', 'https://iina.io/', '#6B46C1', '▶'],
    ['Stats', ['mac'], 'CPU, memory and network in the menu bar.', 'https://github.com/exelban/stats', '#2C2C2E', '📊'],
    ['NewPipe', ['android'], 'Lightweight YouTube client without ads.', 'https://newpipe.net/', '#CD201F', '▶'],
    ['AntennaPod', ['android'], 'Podcast player and manager.', 'https://antennapod.org/', '#2196F3', '🎙'],
    ['Organic Maps', ['android', 'ios'], 'Offline maps for hiking, cycling and driving.', 'https://organicmaps.app/', '#006C35', '🗺'],
    ['Aegis Authenticator', ['android'], 'Two-factor codes, encrypted and backed up.', 'https://getaegis.app/', '#005E9D', '🔐'],
    ['F-Droid', ['android'], 'An app store with only free and open-source Android apps.', 'https://f-droid.org/', '#1976D2', 'F'],
  ].map(([name, p, desc, url, c, i]) => ({ name, p, desc, url, c, i }));

  // Apps you get with a subscription, or free with a student account.
  const SUBS = [
    { name: 'Setapp', with: 'Setapp subscription', p: ['mac', 'ios'], c: '#E74C8B', i: 'S', desc: '240+ premium Mac and iOS apps (CleanShot X, Bartender, Ulysses…) for one monthly fee.', url: 'https://setapp.com/' },
    { name: 'Google Play Pass', with: 'Play Pass', p: ['android'], c: '#01875F', i: '▶', desc: 'Hundreds of Android apps and games with no ads or in-app purchases.', url: 'https://play.google.com/store/pass/getstarted' },
    { name: 'Apple One', with: 'Apple One', p: ['ios', 'mac'], c: '#555555', i: '', desc: 'iCloud+, Apple Music, TV+ and Arcade in one plan.', url: 'https://www.apple.com/apple-one/' },
    { name: 'Microsoft 365', with: 'Microsoft 365 Personal/Family', p: ALL.filter((x) => x !== 'linux'), c: '#D83B01', i: '◆', desc: 'Word, Excel, PowerPoint, Outlook, Clipchamp and 1 TB OneDrive.', url: 'https://www.microsoft.com/microsoft-365' },
    { name: 'Google One', with: 'Google One', p: ALL, c: '#4285F4', i: 'G', desc: 'Extra Google storage plus premium Photos editing and AI features.', url: 'https://one.google.com/' },
    { name: 'Adobe Creative Cloud', with: 'Creative Cloud', p: ['windows', 'mac'], c: '#DA1F26', i: 'Ai', desc: 'Photoshop, Illustrator, Premiere Pro, Acrobat and more.', url: 'https://www.adobe.com/creativecloud.html' },
    { name: 'Amazon Prime', with: 'Amazon Prime', p: ALL, c: '#00A8E1', i: 'a', desc: 'Prime Video, Prime Music and Prime Reading apps, plus Prime Gaming.', url: 'https://www.amazon.com/prime' },
    { name: 'YouTube Premium', with: 'YouTube Premium', p: ALL, c: '#FF0000', i: '▶', desc: 'Ad-free YouTube, background play, downloads and YouTube Music.', url: 'https://www.youtube.com/premium' },
    { name: 'Crunchyroll', with: 'Crunchyroll Premium', p: ALL, c: '#F47521', i: '🍥', desc: 'Ad-free anime streaming; Mega Fan and above add the Game Vault.', url: 'https://www.crunchyroll.com/premium' },
  ];
  const STUDENT = [
    { name: 'GitHub Student Developer Pack', with: 'a verified student account', p: ALL, c: '#24292F', i: 'GH', desc: 'Free GitHub Copilot, JetBrains IDEs, domains, cloud credits and 100+ dev tools.', url: 'https://education.github.com/pack' },
    { name: 'JetBrains for Students', with: 'a student or teacher email', p: DESKTOP, c: '#000000', i: 'JB', desc: 'All JetBrains IDEs (IntelliJ, PyCharm, WebStorm…) free while you study.', url: 'https://www.jetbrains.com/community/education/' },
    { name: 'Autodesk Education', with: 'a student or teacher account', p: ['windows', 'mac'], c: '#0696D7', i: 'A', desc: 'Free AutoCAD, Fusion, Maya and 3ds Max for learning.', url: 'https://www.autodesk.com/education/edu-software' },
    { name: 'Microsoft 365 Education', with: 'a school email', p: ALL.filter((x) => x !== 'linux'), c: '#D83B01', i: '◆', desc: 'Word, Excel, PowerPoint and Teams free for eligible students.', url: 'https://www.microsoft.com/education/products/office' },
  ];

  let tab = 'deals';
  let platform = 'all';

  // ---------------------------------------------------------------- Reddit
  // Official Reddit API ("installed app" client: the ID is public, no secret).
  // Register at https://www.reddit.com/prefs/apps and paste the ID here.
  const REDDIT_CLIENT_ID = '';
  const REDDIT_UA = 'webdeck:app.webdeck.deals:v1.0 (WebDeck free apps & games)';
  const redditConnected = () => Boolean(REDDIT_CLIENT_ID);

  async function redditToken() {
    const cached = await wd.kv.get('redditToken', null);
    if (cached && cached.id === REDDIT_CLIENT_ID && cached.exp > Date.now() + 60000) return cached.token;
    let device = await wd.kv.get('redditDevice', null);
    if (!device) {
      device = Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => b.toString(16).padStart(2, '0')).join('');
      await wd.kv.set('redditDevice', device);
    }
    const res = await wd.net.fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(REDDIT_CLIENT_ID + ':'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': REDDIT_UA,
      },
      body: `grant_type=${encodeURIComponent('https://oauth.reddit.com/grants/installed_client')}&device_id=${device}`,
      timeout: 20,
    });
    if (!res.ok) throw new Error(`Reddit sign-in failed (HTTP ${res.status})`);
    const j = res.json();
    await wd.kv.set('redditToken', { id: REDDIT_CLIENT_ID, token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 });
    return j.access_token;
  }

  async function redditPosts(sub, limit = 75) {
    const token = await redditToken();
    const res = await wd.net.fetch(`https://oauth.reddit.com/r/${sub}/new?limit=${limit}&raw_json=1`, {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': REDDIT_UA },
      timeout: 20,
    });
    if (res.status === 401) await wd.kv.remove('redditToken');
    if (!res.ok) throw new Error(`Reddit returned HTTP ${res.status}`);
    return (res.json().data?.children || []).map((c) => c.data);
  }

  /**
   * Turns a deal post into { kind, name, was, free, platform, image, url, ageH, score }.
   * Titles look like "[App] Name | $1.99 -> Free | 3 days" or "[iOS] [Name] [$2.99 -> Free]".
   */
  function parseDeal(p) {
    const title = p.title || '';
    const tags = [...title.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
    const lower = (title + ' ' + (p.link_flair_text || '')).toLowerCase();
    const kind = /\bgame\b/.test(lower) ? 'Game'
      : /icon/.test(lower) ? 'Icon pack'
      : /widget|theme|wallpaper|kwgt|klwp/.test(lower) ? 'Theme'
      : 'App';
    const priceMatch = title.match(/([$€£₹]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?[$€£₹])\s*(?:->|→|-&gt;|to|➡️?|»)\s*(free\b|[$€£₹]?\s?0(?:[.,]0+)?(?![.,]?\d))/i);
    // A price drop to something other than free is a discount, not a freebie.
    const discount = /[$€£₹]\s?\d+(?:[.,]\d+)?\s*(?:->|→|to|»)\s*[$€£₹]?\s?0*[1-9]|[$€£₹]\s?\d+(?:[.,]\d+)?\s*(?:->|→|to|»)\s*[$€£₹]?\s?0[.,]\d*[1-9]/i.test(title);
    const free = Boolean(priceMatch) || (!discount && /\bfree\b/i.test(title.replace(/free\s*(?:to|-)\s*play|free\s*trial|\bf2p\b/gi, '')));
    let name = title.replace(/\[[^\]]*\]/g, ' ').split(/\s\|\s|\(/)[0]
      .replace(/[$€£₹]\s?\d+(?:[.,]\d+)?\s*(?:->|→|to|»).*$/i, '').replace(/\s+/g, ' ').trim();
    if (!name && tags.length) name = tags.find((t) => !/^(app|game|ios|android|mac|universal|iphone|ipad|icon pack)$/i.test(t) && !/[$€£₹]|free/i.test(t)) || title;
    const platform = /\bios|iphone|ipad\b/.test(lower) ? 'ios' : /\bmac(os)?\b/.test(lower) ? 'mac' : 'android';
    const image = p.preview?.images?.[0]?.resolutions?.slice(-1)[0]?.url || p.preview?.images?.[0]?.source?.url
      || (/^https?:/.test(p.thumbnail || '') ? p.thumbnail : null);
    const expired = /expired|dead|ended/i.test(p.link_flair_text || '') || p.removed_by_category;
    return {
      id: p.id,
      kind,
      name: name || title,
      was: priceMatch ? priceMatch[1].replace(/\s+/g, '') : null,
      free,
      expired: Boolean(expired),
      platform,
      image,
      url: /^https?:/.test(p.url || '') && !/reddit\.com/.test(p.url) ? p.url : `https://www.reddit.com${p.permalink}`,
      thread: `https://www.reddit.com${p.permalink}`,
      ageH: Math.max(0, Math.round((Date.now() / 1000 - p.created_utc) / 3600)),
      score: p.score || 0,
    };
  }

  /** Free (not merely discounted), unexpired deals from a subreddit, cached for 20 minutes. */
  async function freeDeals(sub, force) {
    const key = `reddit_${sub}`;
    const c = await wd.kv.get(key, null);
    if (!force && c && Date.now() - Date.parse(c.at) < 20 * 60 * 1000) return c.data;
    const data = (await redditPosts(sub)).map(parseDeal).filter((d) => d.free && !d.expired);
    await wd.kv.set(key, { at: new Date().toISOString(), data });
    return data;
  }

  const dealAge = (h) => (h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`);

  // -------------------------------------------------------------- Telegram
  // Public channel previews (t.me/s/<channel>) that Telegram serves to anyone.
  const decodeHtml = (s) => s.replace(/&#0*36;/g, '$').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
  const plainText = (html) => decodeHtml(html.replace(/<br\s*\/?>/gi, '\n').replace(/<i class="emoji"[\s\S]*?<\/i>/g, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\p{Extended_Pictographic}|️/gu, ' ').replace(/[ \t]+/g, ' ').trim();

  function parseTelegram(html, channel) {
    const blocks = html.split('<div class="tgme_widget_message_wrap').slice(1);
    const out = [];
    for (const b of blocks) {
      const textHtml = (b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1];
      if (!textHtml) continue;
      const text = plainText(textHtml);
      const label = (text.match(/^\s*(FREE\s+IAP|FREE\s+APP|FREE\s+GAME|FREE|DISCOUNTED\s+\w+|PRICE\s+DROP)/i) || [])[1] || '';
      // The headline is the first bold run that isn't an emoji glyph.
      const bolds = [...textHtml.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((m) => plainText(m[1])).filter((t) => t.length > 12);
      const headline = bolds[0] || text.split('\n').find((l) => l.length > 12) || '';
      const free = /^free/i.test(label) || /\bnow free\b|\bis free\b/i.test(headline);
      const iap = /in-app purchase|\biap\b/i.test(label + ' ' + headline);
      const name = headline.split(/\s+[“"]|\s+is now|\s+in-app|\s+\(/)[0].trim();
      const was = (text.match(/\(was\s*([^)]+)\)/i) || [])[1] || null;
      const tagline = (text.split('\n').map((l) => l.trim()).filter((l) => l && l !== label && !l.includes(name))[0] || '').slice(0, 120);
      const url = decodeHtml((textHtml.match(/href="(https?:\/\/[^"]+)"/) || [])[1] || '');
      // Post photo or link-preview image (Telegram CDN), not the inline emoji sprites.
      const image = (b.match(/background-image:url\('(https:\/\/[^']*(?:telesco\.pe|cdn\d*\.telegram)[^']+)'\)/) || [])[1] || null;
      const when = (b.match(/<time datetime="([^"]+)"/) || [])[1];
      const post = (b.match(/data-post="([^"]+)"/) || [])[1] || '';
      if (!name) continue;
      out.push({
        id: `tg-${post}`,
        kind: /\bgame\b/i.test(label + ' ' + text) ? 'Game' : iap ? 'In-app unlock' : 'App',
        name,
        was,
        free,
        expired: false,
        platform: 'ios',
        tagline,
        image,
        url: url || `https://t.me/${post}`,
        thread: `https://t.me/${post}`,
        source: `@${channel}`,
        ageH: when ? Math.max(0, Math.round((Date.now() - Date.parse(when)) / 3600e3)) : 0,
        score: null,
      });
    }
    return out.reverse(); // newest first
  }

  /** Free deals from a public Telegram channel, cached for 20 minutes. */
  async function telegramDeals(channel, force) {
    const key = `tg_${channel}`;
    const c = await wd.kv.get(key, null);
    if (!force && c && Date.now() - Date.parse(c.at) < 20 * 60 * 1000) return c.data;
    const res = await wd.net.fetch(`https://t.me/s/${channel}`, { timeout: 20 });
    if (!res.ok) throw new Error(`Telegram returned HTTP ${res.status}`);
    // Only recent posts: deals rarely last more than a few days.
    const data = parseTelegram(res.text, channel).filter((d) => d.free && d.ageH <= 24 * 10);
    await wd.kv.set(key, { at: new Date().toISOString(), data });
    return data;
  }

  const dealTile = (d) => `<div class="item" data-open="${esc(d.url)}">
      ${d.image ? `<img class="logo" src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="logo" style="background:#16A34A">${esc(d.name[0] || '?')}</div>`}
      <div class="meta"><div class="name">${esc(d.name)}</div>
        <div class="wd-small" style="margin-top:2px">${d.was ? `<s class="wd-muted">${esc(d.was)}</s> ` : ''}<b style="color:var(--wd-green)">FREE</b>
          <span class="wd-muted">· ${esc(dealAge(d.ageH))}${d.score != null ? ` · ▲ ${d.score}` : ''}</span></div>
        ${d.tagline ? `<div class="wd-small wd-muted" style="margin-top:2px">${esc(d.tagline)}</div>` : ''}
        <div class="tags"><span class="tag">${esc(d.kind)}</span><span class="tag">${d.platform === 'ios' ? 'App Store' : d.platform === 'mac' ? 'Mac App Store' : 'Google Play'}</span>${d.source ? `<span class="tag">${esc(d.source)}</span>` : ''}</div>
      </div></div>`;

  /** App Store freebies: Telegram (no setup) plus r/AppHookup when Reddit is connected. */
  async function iosDeals(force) {
    const head = '<div class="section-title">Free on the App Store right now <span class="wd-small wd-muted">from @AppStoreDeals on Telegram' + (redditConnected() ? ' &amp; r/AppHookup' : '') + '</span></div>';
    const [tgList, rdList] = await Promise.all([
      telegramDeals('AppStoreDeals', force).catch(() => null),
      redditConnected() ? freeDeals('AppHookup', force).catch(() => []) : [],
    ]);
    const seen = new Set();
    const list = [...(tgList || []), ...rdList]
      .filter((d) => d.kind !== 'Game' && d.platform === 'ios')
      .filter((d) => { const k = d.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.ageH - b.ageH);
    if (!tgList && !rdList.length) {
      return head + '<div class="wd-error">Could not load App Store deals right now.</div><div class="links" style="margin-top:6px"><button class="wd-btn" data-open="https://t.me/s/AppStoreDeals">Open @AppStoreDeals</button></div>';
    }
    return head + (list.length ? grid(list.map(dealTile)) : '<div class="wd-empty">No free App Store apps this week. Check back soon.</div>');
  }

  /** Live "free right now" section from a deals subreddit (apps only). */
  async function liveDeals(sub, label, wantPlatform, force) {
    const browse = `<div class="links" style="margin-top:6px"><button class="wd-btn" data-open="https://www.reddit.com/r/${sub}/">Browse r/${sub}</button></div>`;
    const head = `<div class="section-title">${label} <span class="wd-small wd-muted">from r/${sub}</span></div>`;
    if (!redditConnected()) return head + browse;
    try {
      const list = (await freeDeals(sub, force)).filter((d) => d.kind !== 'Game' && (!wantPlatform || d.platform === wantPlatform));
      return head + (list.length ? grid(list.map(dealTile)) : '<div class="wd-empty">No free apps posted right now. Check back soon.</div>');
    } catch (e) {
      return head + `<div class="wd-error">Could not load r/${sub}: ${esc(e.message)}</div>` + browse;
    }
  }

  const defaultCountry = () => {
    const r = (navigator.language || '').split('-')[1]?.toLowerCase();
    return COUNTRIES[r] ? r : 'us';
  };
  const matches = (x) => platform === 'all' || x.p.includes(platform);
  const tagLabel = Object.fromEntries(PLATFORMS);

  const item = (x, extra = '') => `<div class="item" data-open="${esc(x.url)}">
      ${x.image ? `<img class="logo" src="${esc(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : `<div class="logo" style="background:${x.c || '#64748B'}">${esc(x.i || x.name[0])}</div>`}
      <div class="meta"><div class="name">${esc(x.name)}</div>
        ${extra}<div class="wd-small wd-muted" style="line-height:1.4">${esc(x.desc || '')}</div>
        ${x.p ? `<div class="tags">${x.p.map((p) => `<span class="tag">${esc(tagLabel[p])}</span>`).join('')}</div>` : ''}
      </div></div>`;
  const grid = (list) => (list.length ? `<div class="grid">${list.join('')}</div>` : '<div class="wd-empty">Nothing for this platform here yet.</div>');

  async function chart(cc, kind) {
    const key = `${kind}_${cc}`;
    const c = await wd.kv.get(key, null);
    if (c && Date.now() - Date.parse(c.at) < 6 * 3600e3) return c.data;
    const url = kind === 'mac'
      ? `https://itunes.apple.com/${cc}/rss/topfreemacapps/limit=40/json`
      : `https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=60/json`;
    const res = await wd.net.fetch(url, { timeout: 30 });
    if (!res.ok) throw new Error(`App Store returned HTTP ${res.status}`);
    const data = (res.json().feed?.entry || [])
      .map((e) => ({
        name: e['im:name']?.label,
        desc: [e['im:artist']?.label, e.category?.attributes?.label].filter(Boolean).join(' · '),
        category: e.category?.attributes?.label,
        image: (e['im:image'] || []).slice(-1)[0]?.label,
        url: e.link?.attributes?.href || e.id?.label,
      }))
      .filter((a) => a.category !== 'Games') // apps only
      .slice(0, 30);
    await wd.kv.set(key, { at: new Date().toISOString(), data });
    return data;
  }

  async function render() {
    $('platforms').innerHTML = PLATFORMS.map(([id, label]) => `<button class="wd-chip" aria-pressed="${platform === id}" data-platform="${id}">${esc(label)}</button>`).join('');
    const out = $('out');
    if (tab === 'deals') {
      out.innerHTML = '<div class="wd-muted">Loading today\'s free apps…</div>';
      const live = await Promise.all([
        platform === 'all' || platform === 'android' ? liveDeals('googleplaydeals', 'Free on Google Play right now', 'android') : '',
        platform === 'all' || platform === 'ios' ? iosDeals() : '',
      ]);
      if (tab !== 'deals') return;
      out.innerHTML = `<div class="wd-notice">Paid apps regularly go free for a few hours or days. Grab them before the deal ends.</div>
        ${live.join('')}
        <div class="section-title">More places paid apps go free</div>${grid(DEALS.filter(matches).map((x) => item(x)))}`;
    } else if (tab === 'top') {
      const cc = await wd.kv.get('country', defaultCountry());
      const wantIos = platform === 'all' || platform === 'ios';
      const wantMac = platform === 'all' || platform === 'mac';
      out.innerHTML = '<div class="wd-muted">Loading charts…</div>';
      const [ios, mac] = await Promise.all([
        wantIos ? chart(cc, 'ios').catch(() => null) : null,
        wantMac ? chart(cc, 'mac').catch(() => null) : null,
      ]);
      const failed = '<div class="wd-error">Could not load this chart. Check your connection.</div>';
      out.innerHTML = [
        wantIos ? `<div class="section-title">App Store: top free iPhone & iPad apps <span class="wd-small wd-muted">${esc(COUNTRIES[cc])}</span></div>${ios ? grid(ios.map((a) => item(a))) : failed}` : '',
        wantMac ? `<div class="section-title">Mac App Store: top free apps <span class="wd-small wd-muted">${esc(COUNTRIES[cc])}</span></div>${mac ? grid(mac.map((a) => item(a))) : failed}` : '',
        platform === 'all' || platform === 'android' ? `<div class="section-title">Google Play</div>
          <div class="links"><button class="wd-btn" data-open="https://play.google.com/store/apps/top">📱 Top free apps</button>
          <button class="wd-btn" data-open="https://play.google.com/store/apps/category/PRODUCTIVITY">💼 Productivity</button>
          <button class="wd-btn" data-open="https://play.google.com/store/apps/category/TOOLS">🛠️ Tools</button>
          <button class="wd-btn" data-open="https://f-droid.org/">🤖 F-Droid (open source)</button></div>` : '',
        platform === 'all' || platform === 'windows' ? `<div class="section-title">Windows</div>
          <div class="links"><button class="wd-btn" data-open="https://apps.microsoft.com/home">🪟 Microsoft Store</button>
          <button class="wd-btn" data-open="https://winstall.app/">📦 winstall (winget apps)</button></div>` : '',
        platform === 'all' || platform === 'linux' ? `<div class="section-title">Linux</div>
          <div class="links"><button class="wd-btn" data-open="https://flathub.org/">📦 Flathub</button>
          <button class="wd-btn" data-open="https://snapcraft.io/store">🧩 Snap Store</button></div>` : '',
      ].join('');
    } else if (tab === 'oss') {
      out.innerHTML = `<div class="wd-notice">Free forever, open source, no ads. Hand-picked apps that replace popular paid ones.</div>${grid(OSS.filter(matches).map((x) => item(x)))}`;
    } else {
      const sub = (x) => item(x, `<div class="wd-small wd-muted" style="margin:2px 0 4px">Requires ${esc(x.with)}</div>`);
      out.innerHTML = `<div class="section-title">Included with a subscription <span class="wd-small wd-muted">one plan, many apps</span></div>${grid(SUBS.filter(matches).map(sub))}
        <div class="section-title">Free with a student account</div>${grid(STUDENT.filter(matches).map((x) => item(x, `<div class="wd-small wd-muted" style="margin:2px 0 4px">Needs ${esc(x.with)}</div>`)))}`;
    }
  }

  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    wd.kv.set('tab', tab);
    render();
  }));
  $('platforms').addEventListener('click', (e) => {
    const p = e.target.closest('[data-platform]')?.dataset.platform;
    if (p) { platform = p; wd.kv.set('platform', p); render(); }
  });
  $('country').onchange = async () => { await wd.kv.set('country', $('country').value); render(); };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open]');
    if (el) wd.openUrl(el.dataset.open).catch((err) => wd.ui.toast(err.message, 'error'));
  });

  (async () => {
    tab = await wd.kv.get('tab', 'deals');
    platform = await wd.kv.get('platform', 'all');
    const cc = await wd.kv.get('country', defaultCountry());
    $('country').innerHTML = Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${k === cc ? 'selected' : ''}>${esc(v)}</option>`).join('');
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === tab)));
    render();
  })();
})();
