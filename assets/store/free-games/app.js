(() => {
  const wd = window.webdeck;
  const $ = (id) => document.getElementById(id);
  const esc = wd.ui.escape;
  const GAMERPOWER = 'https://www.gamerpower.com/api/giveaways';
  const EPIC = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US';
  const FREETOGAME = 'https://www.freetogame.com/api/games?sort-by=relevance';

  const PLATFORMS = [
    { id: 'epic', label: 'Epic Games', match: /epic games/i },
    { id: 'steam', label: 'Steam', match: /steam/i },
    { id: 'gog', label: 'GOG', match: /\bgog\b/i },
    { id: 'itch', label: 'itch.io', match: /itch\.io/i },
    { id: 'pc-other', label: 'Other PC / DRM-free', match: /drm-free|indiegala/i },
    { id: 'playstation', label: 'PlayStation', match: /ps4|ps5|playstation/i },
    { id: 'xbox', label: 'Xbox', match: /xbox/i },
    { id: 'switch', label: 'Switch', match: /switch/i },
    { id: 'mobile', label: 'Android / iOS', match: /android|ios/i },
    { id: 'vr', label: 'VR', match: /\bvr\b/i },
  ];
  const DEFAULT_NOTIFY = ['epic', 'steam', 'gog'];
  const PC_STORES = ['epic', 'steam', 'gog', 'itch', 'pc-other'];
  // Giveaways that only members of a paid service can claim.
  const MEMBERSHIP = /prime gaming|amazon prime|\bluna\b|playstation plus|ps plus|game pass|humble choice|ea play|ubisoft\+|nintendo switch online/i;

  // Claim once, keep forever (some need a membership to claim).
  const KEEP_SERVICES = [
    { name: 'Prime Gaming', with: 'Amazon Prime', icon: '👑', color: '#00A8E1', desc: 'New free PC games every month: claim them on Amazon Games, GOG or Epic and they\'re yours for good, even if Prime ends.', url: 'https://gaming.amazon.com/home' },
    { name: 'Humble Choice', with: 'Humble membership', icon: '🧡', color: '#CC2929', desc: 'A curated set of PC games each month as Steam keys you keep.', url: 'https://www.humblebundle.com/membership' },
    { name: 'Epic Games Store', with: 'no membership: free account', icon: '⚫', color: '#2A2A2A', desc: 'A free game (sometimes more) every week. Claim it during the promotion and keep it.', url: 'https://store.epicgames.com/free-games' },
    { name: 'Ubisoft Connect', with: 'no membership: free account', icon: '🌀', color: '#0091FF', desc: 'Occasional free-to-keep giveaways of Ubisoft classics.', url: 'https://store.ubisoft.com/free-games' },
  ];
  // Playable while your membership is active.
  const SUB_SERVICES = [
    { name: 'Xbox Game Pass', with: 'Game Pass', icon: '🟩', color: '#107C10', desc: 'Hundreds of console and PC games, new titles on day one.', url: 'https://www.xbox.com/xbox-game-pass/games' },
    { name: 'PlayStation Plus', with: 'PS Plus Essential, Extra or Premium', icon: '🎮', color: '#0070D1', desc: 'Monthly games plus, on Extra/Premium, a catalog of hundreds of PS4/PS5 games.', url: 'https://www.playstation.com/ps-plus/whats-new/' },
    { name: 'Crunchyroll Game Vault', with: 'Crunchyroll Mega Fan or Ultimate Fan', icon: '🍥', color: '#F47521', desc: 'Premium mobile games for Android and iOS with no ads or in-app purchases.', url: 'https://www.crunchyroll.com/games/index.html' },
    { name: 'Apple Arcade', with: 'Apple Arcade / Apple One', icon: '🍎', color: '#555555', desc: '200+ ad-free games with no in-app purchases on iPhone, iPad, Mac and Apple TV.', url: 'https://www.apple.com/apple-arcade/' },
    { name: 'Netflix Games', with: 'any Netflix plan', icon: '🎬', color: '#E50914', desc: 'Mobile, TV and browser games with no ads or purchases.', url: 'https://www.netflix.com/tudum/games' },
    { name: 'Google Play Pass', with: 'Play Pass', icon: '▶️', color: '#01875F', desc: 'Hundreds of Android games with no ads or in-app purchases.', url: 'https://play.google.com/store/pass/getstarted' },
    { name: 'EA Play', with: 'EA Play', icon: '🅴', color: '#FF4747', desc: 'EA\'s game vault on PC, PlayStation and Xbox, plus 10-hour trials.', url: 'https://www.ea.com/ea-play' },
    { name: 'Ubisoft+', with: 'Ubisoft+', icon: '🌀', color: '#0091FF', desc: 'Ubisoft\'s catalog on PC, including new releases.', url: 'https://www.ubisoft.com/ubisoft-plus' },
    { name: 'Nintendo Switch Online', with: 'NSO', icon: '🔴', color: '#E60012', desc: 'Classic NES, SNES and Game Boy libraries (N64/GBA with Expansion Pack).', url: 'https://www.nintendo.com/switch/online/' },
    { name: 'Amazon Luna', with: 'Amazon Prime (Prime channel)', icon: '☁️', color: '#7B3FE4', desc: 'Rotating cloud-streamed games in a browser or on a TV.', url: 'https://luna.amazon.com/' },
  ];

  const COMMUNITIES = [
    { name: 'r/FreeGameFindings', desc: 'Every free-to-keep PC and console game, posted by the community.', url: 'https://www.reddit.com/r/FreeGameFindings/' },
    { name: 'r/googleplaydeals', desc: 'Paid Play Store games and apps that are free for a limited time.', url: 'https://www.reddit.com/r/googleplaydeals/' },
    { name: 'r/AppHookup', desc: 'iOS and Android games and apps on sale or free.', url: 'https://www.reddit.com/r/AppHookup/' },
    { name: 'r/GameDeals', desc: 'PC game deals, including 100% off giveaways.', url: 'https://www.reddit.com/r/GameDeals/' },
    { name: 'r/PlayStationPlus', desc: 'Monthly PS Plus games and catalog news.', url: 'https://www.reddit.com/r/PlayStationPlus/' },
    { name: 'r/XboxGamePass', desc: 'What\'s joining and leaving Game Pass.', url: 'https://www.reddit.com/r/XboxGamePass/' },
    { name: 'r/primegaming', desc: 'Prime Gaming free games and loot each month.', url: 'https://www.reddit.com/r/primegaming/' },
    { name: 'Steam: free to keep', desc: 'Steam games currently 100% off.', url: 'https://store.steampowered.com/search/?maxprice=free&specials=1' },
    { name: 'GOG free games', desc: 'Free DRM-free games on GOG.', url: 'https://www.gog.com/en/games?priceRange=0,0' },
    { name: 'itch.io: free & 100% off', desc: 'Indie games that are free right now.', url: 'https://itch.io/games/on-sale' },
    { name: 'IndieGala Freebies', desc: 'Free indie games to keep.', url: 'https://freebies.indiegala.com/' },
    { name: 'GamerPower', desc: 'All active giveaways, including loot and betas.', url: 'https://www.gamerpower.com/' },
  ];

  const COUNTRIES = { in: 'India', us: 'United States', gb: 'United Kingdom', ca: 'Canada', au: 'Australia', de: 'Germany', fr: 'France', jp: 'Japan', br: 'Brazil', ae: 'UAE', sg: 'Singapore' };
  const defaultCountry = () => {
    const region = (navigator.language || '').split('-')[1]?.toLowerCase();
    return COUNTRIES[region] ? region : 'us';
  };

  function platformsOf(g) {
    const parts = g.platforms.split(',').map((s) => s.trim());
    const ids = PLATFORMS.filter((p) => parts.some((s) => p.match.test(s))).map((p) => p.id);
    if (parts.some((s) => /^pc$/i.test(s)) && !ids.some((id) => PC_STORES.includes(id))) ids.push('pc-other');
    return ids;
  }
  const needsMembership = (g) => MEMBERSHIP.test(`${g.title} ${g.description || ''} ${g.instructions || ''}`);
  const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  async function getJson(url, timeout = 30) {
    const res = await wd.net.fetch(url, { timeout });
    if (res.status === 201) return []; // GamerPower: nothing active for this query
    if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
    return res.json();
  }

  // -------------------------------------------------------------- sources
  async function fetchGiveaways(includeLoot) {
    const types = includeLoot ? ['game', 'loot'] : ['game'];
    const all = [];
    for (const type of types) {
      const list = await getJson(`${GAMERPOWER}?type=${type}&sort-by=date`);
      if (Array.isArray(list)) all.push(...list);
    }
    return all.map((g) => ({
      id: String(g.id),
      title: g.title.replace(/\s*\((Epic Games|Steam|GOG|IndieGala|Itch\.io)\)\s*Giveaway$/i, '').replace(/\s*Giveaway$/i, ''),
      worth: g.worth && g.worth !== 'N/A' ? g.worth : null,
      image: g.image || g.thumbnail,
      platforms: g.platforms || '',
      type: g.type,
      endDate: g.end_date && g.end_date !== 'N/A' ? g.end_date.replace(' ', 'T') : null,
      url: g.open_giveaway_url || g.gamerpower_url,
      description: g.description,
      instructions: g.instructions,
      published: g.published_date,
    }));
  }

  /** Epic's own feed: what's free now and what's free next week. */
  async function fetchEpic() {
    const cc = (await wd.kv.get('country', defaultCountry())).toUpperCase();
    const data = await getJson(`${EPIC}&country=${cc}&allowCountries=${cc}`);
    const els = data?.data?.Catalog?.searchStore?.elements || [];
    const out = [];
    for (const g of els) {
      const p = g.promotions || {};
      const free = (groups) => groups.flatMap((x) => x.promotionalOffers || []).find((o) => o.discountSetting?.discountPercentage === 0);
      const now = free(p.promotionalOffers || []);
      const next = free(p.upcomingPromotionalOffers || []);
      if (!now && !next) continue;
      const slug = g.offerMappings?.[0]?.pageSlug || g.catalogNs?.mappings?.[0]?.pageSlug || g.productSlug;
      const img = (g.keyImages || []).find((k) => k.type === 'OfferImageWide') || (g.keyImages || [])[0];
      out.push({
        id: `epic-${g.id}`,
        title: g.title,
        image: img?.url,
        worth: g.price?.totalPrice?.fmtPrice?.originalPrice || null,
        platforms: 'PC, Epic Games Store',
        type: 'Game',
        status: now ? 'now' : 'soon',
        startDate: (now || next).startDate,
        endDate: (now || next).endDate,
        url: slug ? `https://store.epicgames.com/p/${slug}` : 'https://store.epicgames.com/free-games',
      });
    }
    return out;
  }

  async function fetchFreeToPlay() {
    const list = await getJson(FREETOGAME);
    return (Array.isArray(list) ? list : []).map((g) => ({
      id: `f2p-${g.id}`,
      title: g.title,
      image: g.thumbnail,
      genre: g.genre,
      platform: /browser/i.test(g.platform) ? 'Browser' : 'PC',
      desc: g.short_description,
      publisher: g.publisher,
      url: g.game_url || g.freetogame_profile_url,
    }));
  }

  async function fetchAppleChart(cc, games) {
    const url = `https://itunes.apple.com/${cc}/rss/topfreeapplications/limit=30${games ? '/genre=6014' : ''}/json`;
    const data = await getJson(url);
    return (data?.feed?.entry || []).map((e) => ({
      name: e['im:name']?.label,
      by: e['im:artist']?.label,
      category: e.category?.attributes?.label,
      image: (e['im:image'] || []).slice(-1)[0]?.label,
      url: e.link?.attributes?.href || e.id?.label,
    }));
  }

  /** Current Xbox Game Pass console catalog (titles + cover art). */
  async function fetchGamePass() {
    const cc = (await wd.kv.get('country', defaultCountry())).toUpperCase();
    const list = await getJson(`https://catalog.gamepass.com/sigls/v2?id=fdd9e2a7-0fee-49f6-ad69-4354098401ff&language=en-us&market=${cc}`);
    const ids = (Array.isArray(list) ? list : []).map((x) => x.id).filter(Boolean);
    const games = [];
    for (let i = 0; i < Math.min(ids.length, 60); i += 20) {
      const data = await getJson(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.slice(i, i + 20).join(',')}&market=${cc}&languages=en-us`);
      for (const p of data.Products || []) {
        const lp = (p.LocalizedProperties || [])[0] || {};
        const img = (lp.Images || []).find((x) => x.ImagePurpose === 'Poster') || (lp.Images || []).find((x) => x.ImagePurpose === 'BoxArt');
        games.push({
          title: lp.ProductTitle,
          image: img ? (img.Uri.startsWith('//') ? 'https:' + img.Uri : img.Uri) : null,
          url: `https://www.xbox.com/games/store/game/${p.ProductId}`,
        });
      }
    }
    return { total: ids.length, games };
  }

  /** Latest PlayStation Plus announcements (monthly games / catalog) from the PlayStation Blog. */
  async function fetchPsPlus() {
    const res = await wd.net.fetch('https://blog.playstation.com/feed/', { timeout: 30 });
    if (!res.ok) throw new Error(`PlayStation Blog returned HTTP ${res.status}`);
    const items = [...res.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const tag = (t) => (m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || '';
      const img = m[1].match(/<media:content[^>]+url="([^"]+)"/) || m[1].match(/<img[^>]+src="([^"]+)"/);
      return { title: tag('title').replace(/&#8217;/g, "'").replace(/&amp;/g, '&'), url: tag('link'), date: tag('pubDate'), image: img ? img[1] : null };
    });
    return items.filter((i) => /playstation plus|ps plus/i.test(i.title)).slice(0, 6);
  }

  /** Cached fetch helper: returns cached data younger than maxAgeMs unless forced. */
  async function cached(key, maxAgeMs, loader, force) {
    const c = await wd.kv.get(key, null);
    if (!force && c && Date.now() - Date.parse(c.at) < maxAgeMs) return c.data;
    try {
      const data = await loader();
      await wd.kv.set(key, { at: new Date().toISOString(), data });
      return data;
    } catch (e) {
      if (c) return c.data; // stale is better than nothing
      throw e;
    }
  }

  // ------------------------------------------------------- background job
  if (wd.job.active) {
    wd.job.run(async () => {
      const includeLoot = await wd.kv.get('includeLoot', false);
      const games = await fetchGiveaways(includeLoot);
      await wd.kv.set('cache', { at: new Date().toISOString(), games });
      let epic = [];
      try { epic = await fetchEpic(); await wd.kv.set('epicCache', { at: new Date().toISOString(), data: epic }); } catch (_) {}
      const pool = [...games, ...epic.filter((e) => e.status === 'now')];
      const seen = new Set(await wd.kv.get('seen', []));
      const firstRun = seen.size === 0;
      const notifyFor = new Set(await wd.kv.get('notifyPlatforms', DEFAULT_NOTIFY));
      const fresh = pool.filter((g) => !seen.has(g.id) && platformsOf(g).some((p) => notifyFor.has(p)));
      pool.forEach((g) => seen.add(g.id));
      await wd.kv.set('seen', [...seen].slice(-1500));
      if (!firstRun && fresh.length) {
        const names = fresh.slice(0, 3).map((g) => g.title).join(', ');
        await wd.notify(
          fresh.length === 1 ? `Free now: ${fresh[0].title}` : `${fresh.length} new free games`,
          fresh.length === 1 ? `${fresh[0].platforms}${fresh[0].worth ? ` · worth ${fresh[0].worth}` : ''}` : names + (fresh.length > 3 ? '…' : ''),
          { url: fresh.length === 1 ? fresh[0].url : undefined },
        );
      }
      return `${pool.length} free now, ${firstRun ? 'baseline saved' : `${fresh.length} new`}`;
    });
    return;
  }

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

  // ------------------------------------------------------------------- UI
  let giveaways = [];
  let epic = [];
  let filter = 'all';
  let seen = new Set();
  let f2p = [];
  let f2pFilter = 'all';
  let f2pShown = 48;
  let tab = 'giveaways';
  const loaded = {};

  function remaining(end) {
    if (!end) return '';
    const ms = Date.parse(end) - Date.now();
    if (Number.isNaN(ms)) return '';
    if (ms <= 0) return 'Ending';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    return d > 0 ? `${d}d ${h}h left` : `${h}h left`;
  }
  function startsIn(start) {
    const ms = Date.parse(start) - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return 'Starting soon';
    const d = Math.floor(ms / 86400000);
    return d > 0 ? `Free in ${d}d ${Math.floor((ms % 86400000) / 3600000)}h` : `Free in ${Math.floor(ms / 3600000)}h`;
  }

  function card(g, { badge = '', foot } = {}) {
    return `<div class="game">
      ${g.image ? `<img class="cover" src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="body">
        <div class="wd-row" style="gap:6px">${badge}<span class="wd-small wd-muted wd-ellipsis wd-grow">${esc(g.platforms || '')}</span></div>
        <div class="title">${esc(g.title)}</div>
        <div class="foot">${foot}</div>
      </div>
    </div>`;
  }
  const getBtn = (url, label = 'Get') => `<button class="wd-btn wd-btn-primary wd-btn-sm" data-open="${esc(url)}">${label}</button>`;

  /** Free-to-keep list: GamerPower + Epic's own "free now" (deduped). */
  function freeNow() {
    const names = new Set(giveaways.map((g) => norm(g.title)));
    const epicNow = epic.filter((e) => e.status === 'now' && !names.has(norm(e.title)));
    return [...epicNow, ...giveaways.filter((g) => !needsMembership(g))];
  }

  function renderGiveaways() {
    const list = freeNow();
    const counts = {};
    list.forEach((g) => platformsOf(g).forEach((p) => (counts[p] = (counts[p] || 0) + 1)));
    $('chips').innerHTML = [{ id: 'all', label: 'All' }, ...PLATFORMS.filter((p) => counts[p.id])]
      .map((p) => `<button class="wd-chip" aria-pressed="${filter === p.id}" data-filter="${p.id}">${esc(p.label)} ${p.id === 'all' ? list.length : counts[p.id]}</button>`)
      .join('');
    const shown = filter === 'all' ? list : list.filter((g) => platformsOf(g).includes(filter));
    $('games').innerHTML = shown.length
      ? shown.map((g) => card(g, {
          badge: `${!seen.has(g.id) ? '<span class="wd-badge wd-badge-blue">New</span>' : ''}${g.type && g.type !== 'Game' ? `<span class="wd-badge">${esc(g.type)}</span>` : ''}`,
          foot: `<span class="free">FREE</span>${g.worth ? `<span class="worth">${esc(g.worth)}</span>` : ''}<span class="wd-spacer"></span><span class="wd-small wd-muted">${remaining(g.endDate)}</span>${getBtn(g.url)}`,
        })).join('')
      : '<div class="wd-empty" style="grid-column:1/-1"><div class="wd-empty-icon">🕹️</div>No giveaways right now.</div>';

    const soon = epic.filter((e) => e.status === 'soon');
    $('upcoming').innerHTML = soon.length && (filter === 'all' || filter === 'epic')
      ? `<div class="section-title">Coming next on Epic <span class="wd-small wd-muted">free to keep once the promotion starts</span></div>
         <div class="games">${soon.map((g) => card(g, {
           badge: '<span class="wd-badge wd-badge-amber">Soon</span>',
           foot: `<span class="soon">${esc(startsIn(g.startDate))}</span>${g.worth ? `<span class="worth">${esc(g.worth)}</span>` : ''}<span class="wd-spacer"></span>${getBtn(g.url, 'View')}`,
         })).join('')}</div>`
      : '';
  }

  function renderF2P() {
    const genres = {};
    f2p.forEach((g) => { genres[g.genre] = (genres[g.genre] || 0) + 1; });
    const top = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g);
    const chips = [['all', `All ${f2p.length}`], ['Browser', 'Play in browser'], ['PC', 'PC'], ...top.map((g) => [g, g])];
    $('f2pChips').innerHTML = chips.map(([id, label]) => `<button class="wd-chip" aria-pressed="${f2pFilter === id}" data-f2p="${esc(id)}">${esc(label)}</button>`).join('');
    const list = f2p.filter((g) => f2pFilter === 'all' || g.platform === f2pFilter || g.genre === f2pFilter);
    $('f2pGames').innerHTML = list.slice(0, f2pShown).map((g) => card({ ...g, platforms: `${g.platform} · ${g.genre}` }, {
      foot: `<span class="free">FREE TO PLAY</span><span class="wd-spacer"></span>${getBtn(g.url, g.platform === 'Browser' ? 'Play' : 'Get')}`,
    }).replace('<div class="foot">', `<div class="wd-small wd-muted" style="line-height:1.4">${esc(g.desc || '')}</div><div class="foot">`)).join('')
      + (list.length > f2pShown ? `<div style="grid-column:1/-1;text-align:center"><button class="wd-btn" id="f2pMore">Show more (${list.length - f2pShown})</button></div>` : '');
    const more = $('f2pMore');
    if (more) more.onclick = () => { f2pShown += 48; renderF2P(); };
  }

  const appTile = (a) => `<div class="app" data-open="${esc(a.url)}">
      ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="meta"><div class="wd-ellipsis" style="font-weight:650">${esc(a.name)}</div>
      <div class="wd-small wd-muted wd-ellipsis">${esc([a.by, a.category].filter(Boolean).join(' · '))}</div></div></div>`;

  /** Paid mobile games that just went free: Telegram (no setup) plus Reddit when connected. */
  async function redditGames(force) {
    const browse = '<div class="links" style="margin-top:8px"><button class="wd-btn" data-open="https://www.reddit.com/r/googleplaydeals/">Browse r/googleplaydeals</button><button class="wd-btn" data-open="https://www.reddit.com/r/AppHookup/">Browse r/AppHookup</button><button class="wd-btn" data-open="https://t.me/AppStoreDeals">@AppStoreDeals</button></div>';
    const head = `<div class="section-title">Paid games free today <span class="wd-small wd-muted">from @AppStoreDeals${redditConnected() ? ', r/googleplaydeals &amp; r/AppHookup' : ''}</span></div>`;
    const [tgList, play, hook] = await Promise.all([
      telegramDeals('AppStoreDeals', force).catch(() => []),
      redditConnected() ? freeDeals('googleplaydeals', force).catch(() => []) : [],
      redditConnected() ? freeDeals('AppHookup', force).catch(() => []) : [],
    ]);
    const games = [...tgList, ...play, ...hook].filter((d) => d.kind === 'Game').sort((a, b) => a.ageH - b.ageH);
    return head + (games.length ? `<div class="apps">${games.map((d) => `<div class="app" data-open="${esc(d.url)}">
        ${d.image ? `<img src="${esc(d.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <div class="meta"><div class="wd-ellipsis" style="font-weight:650">${esc(d.name)}</div>
        <div class="wd-small">${d.was ? `<s class="wd-muted">${esc(d.was)}</s> ` : ''}<span class="free">FREE</span> <span class="wd-muted">· ${d.platform === 'ios' ? 'App Store' : 'Google Play'} · ${esc(dealAge(d.ageH))}</span></div></div></div>`).join('')}</div>`
      : '<div class="wd-empty">No paid mobile games went free recently.</div>' + (redditConnected() ? '' : browse));
  }

  async function renderMobile(force) {
    const cc = await wd.kv.get('country', defaultCountry());
    $('mobileOut').innerHTML = '<div class="wd-muted">Loading…</div>';
    const paidFree = giveaways.filter((g) => platformsOf(g).includes('mobile'));
    const games = await cached(`appleGames_${cc}`, 6 * 3600e3, () => fetchAppleChart(cc, true), force).catch(() => null);
    const play = (path) => `https://play.google.com/store/${path}`;
    $('mobileOut').innerHTML = `
      <div class="section-title">Paid games free right now <span class="wd-small wd-muted">Android &amp; iOS giveaways</span></div>
      ${paidFree.length ? `<div class="games">${paidFree.map((g) => card(g, {
        foot: `<span class="free">FREE</span>${g.worth ? `<span class="worth">${esc(g.worth)}</span>` : ''}<span class="wd-spacer"></span><span class="wd-small wd-muted">${remaining(g.endDate)}</span>${getBtn(g.url)}`,
      })).join('')}</div>` : '<div class="wd-empty">No paid mobile games are free at the moment. Turn on alerts for "Android / iOS" to hear about the next one.</div>'}

      <div class="section-title">Google Play <span class="wd-small wd-muted">opens the Play Store</span></div>
      <div class="links">
        <button class="wd-btn" data-open="${play('games')}">🎮 Free games</button>
        <button class="wd-btn" data-open="${play('apps/category/GAME/collection/topselling_free')}">🏆 Top free games chart</button>
        <button class="wd-btn" data-open="${play('pass/getstarted')}">▶️ Play Pass</button>
      </div>
      ${await redditGames(force)}

      <div class="section-title">App Store: top free games <span class="wd-small wd-muted">${esc(COUNTRIES[cc])}</span></div>
      ${games ? `<div class="apps">${games.map(appTile).join('')}</div>` : '<div class="wd-error">Could not load the App Store chart.</div>'}
      <p class="wd-small wd-muted" style="margin-top:14px">Looking for free apps instead of games? Get the <b>Free Apps</b> extension from the Store.</p>`;
  }

  /** Which provider a free-to-keep giveaway comes from. */
  function provider(g) {
    if (String(g.id).startsWith('epic-') || /epic games/i.test(g.platforms)) return 'Epic Games Store';
    if (needsMembership(g)) return 'Prime Gaming & member giveaways';
    if (/ubisoft/i.test(g.platforms)) return 'Ubisoft Connect';
    if (/android|ios/i.test(g.platforms)) return 'Play Store & App Store';
    if (/steam/i.test(g.platforms)) return 'Steam';
    if (/\bgog\b/i.test(g.platforms)) return 'GOG';
    if (/ps4|ps5|playstation|xbox|switch/i.test(g.platforms)) return 'Consoles';
    return 'itch.io, IndieGala & others';
  }
  const PROVIDER_ORDER = ['Epic Games Store', 'Prime Gaming & member giveaways', 'Ubisoft Connect', 'Steam', 'GOG', 'Play Store & App Store', 'Consoles', 'itch.io, IndieGala & others'];

  const serviceCard = (s) => `<div class="sub-card">
      <div class="logo" style="background:${s.color}">${s.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${esc(s.name)}</div>
        <div class="wd-small wd-muted" style="margin:2px 0 4px">${/^no membership/.test(s.with) ? esc(s.with.replace(/^no membership: /, 'Free · ')) : 'Requires ' + esc(s.with)}</div>
        <div class="wd-small" style="line-height:1.4">${esc(s.desc)}</div>
        <button class="wd-btn wd-btn-sm" style="margin-top:8px" data-open="${esc(s.url)}">See this month's games</button>
      </div></div>`;

  async function renderSubs(force) {
    // Keep forever: every current giveaway, grouped by where you claim it.
    const all = [...epic.filter((e) => e.status === 'now'), ...giveaways];
    const seenTitles = new Set();
    const groups = {};
    for (const g of all) {
      const key = norm(g.title);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      (groups[provider(g)] ||= []).push(g);
    }
    $('keepGroups').innerHTML = PROVIDER_ORDER.filter((p) => groups[p]?.length).map((p) => `
      <div class="group-title">${esc(p)} <span class="wd-badge">${groups[p].length}</span>${p.startsWith('Prime') ? '<span class="wd-badge wd-badge-amber">needs Prime</span>' : ''}</div>
      <div class="games">${groups[p].map((g) => card(g, {
        foot: `<span class="free">FREE</span>${g.worth ? `<span class="worth">${esc(g.worth)}</span>` : ''}<span class="wd-spacer"></span><span class="wd-small wd-muted">${remaining(g.endDate)}</span>${getBtn(g.url, 'Claim')}`,
      })).join('')}</div>`).join('') || '<div class="wd-empty">No free-to-keep games right now.</div>';
    $('keepServices').innerHTML = KEEP_SERVICES.map(serviceCard).join('');
    $('subServices').innerHTML = SUB_SERVICES.map(serviceCard).join('');

    // While subscribed: live catalogs where the services publish them.
    $('subCatalogs').innerHTML = '<div class="wd-muted">Loading what\'s included…</div>';
    const [gp, ps] = await Promise.all([
      cached('gamePass', 24 * 3600e3, fetchGamePass, force).catch(() => null),
      cached('psPlus', 6 * 3600e3, fetchPsPlus, force).catch(() => null),
    ]);
    $('subCatalogs').innerHTML = `
      <div class="catalog">
        <div class="group-title" style="margin-top:0">🟩 Included with Xbox Game Pass ${gp ? `<span class="wd-badge">${gp.total} games</span>` : ''}</div>
        ${gp ? `<div class="strip">${gp.games.map((g) => `<div class="mini" data-open="${esc(g.url)}">${g.image ? `<img src="${esc(g.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="t">${esc(g.title)}</div></div>`).join('')}
          </div><button class="wd-btn wd-btn-sm" data-open="https://www.xbox.com/xbox-game-pass/games">See all ${gp.total}</button>`
          : '<div class="wd-small wd-muted">Could not load the Game Pass catalog.</div>'}
      </div>
      <div class="catalog">
        <div class="group-title" style="margin-top:0">🎮 PlayStation Plus: latest monthly games & catalog</div>
        ${ps && ps.length ? ps.map((i) => `<div class="post" data-open="${esc(i.url)}"><div style="font-weight:600">${esc(i.title)}</div>
          <div class="wd-small wd-muted">${esc(i.date ? new Date(i.date).toLocaleDateString() : '')} · PlayStation Blog</div></div>`).join('')
          : '<div class="wd-small wd-muted">Could not load PlayStation Plus news.</div>'}
      </div>`;
  }

  function renderCommunities() {
    $('communities').innerHTML = COMMUNITIES.map((c) => `<div class="app" data-open="${esc(c.url)}">
      <div class="logo" style="width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:${c.name.startsWith('r/') ? '#FF4500' : 'var(--wd-surface-2)'};color:#fff;font-weight:800;flex:none">${c.name.startsWith('r/') ? 'r/' : '↗'}</div>
      <div class="meta"><div class="wd-ellipsis" style="font-weight:650">${esc(c.name)}</div><div class="wd-small wd-muted">${esc(c.desc)}</div></div></div>`).join('');
  }

  async function loadTab(force) {
    $('error').innerHTML = '';
    try {
      if (tab === 'giveaways' || tab === 'subs') {
        if (force || !loaded.giveaways) {
          const cache = await wd.kv.get('cache', null);
          const fresh = cache && Date.now() - Date.parse(cache.at) < 30 * 60 * 1000;
          giveaways = !force && fresh ? cache.games : await fetchGiveaways(await wd.kv.get('includeLoot', false));
          if (force || !fresh) await wd.kv.set('cache', { at: new Date().toISOString(), games: giveaways });
          epic = await cached('epicCache', 30 * 60 * 1000, fetchEpic, force).catch(() => []);
          loaded.giveaways = true;
          $('sub').textContent = `${freeNow().length} free to keep right now · updated ${wd.ui.timeAgo((await wd.kv.get('cache')).at)}`;
        }
        if (tab === 'subs') await renderSubs(force);
        else { renderGiveaways(); renderCommunities(); }
        const merged = new Set([...(await wd.kv.get('seen', [])), ...freeNow().map((g) => g.id)]);
        await wd.kv.set('seen', [...merged].slice(-1500));
      } else if (tab === 'f2p') {
        if (force || !loaded.f2p) {
          $('f2pGames').innerHTML = '<div class="wd-muted">Loading…</div>';
          f2p = await cached('f2pCache', 12 * 3600e3, fetchFreeToPlay, force);
          loaded.f2p = true;
        }
        renderF2P();
      } else if (tab === 'mobile') {
        if (!loaded.giveaways) { tab = 'giveaways'; await loadTab(false); tab = 'mobile'; }
        await renderMobile(force);
      }
    } catch (e) {
      const cache = await wd.kv.get('cache', null);
      if (tab === 'giveaways' && cache) { giveaways = cache.games; renderGiveaways(); }
      $('error').innerHTML = `<div class="wd-error" style="margin-bottom:12px">Could not refresh: ${esc(e.message)}${cache ? '. Showing saved list.' : ''}</div>`;
    }
  }

  function showTab(t) {
    tab = t;
    document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    for (const id of ['giveaways', 'f2p', 'mobile', 'subs']) $(id).hidden = id !== t;
    wd.kv.set('tab', t);
    loadTab(false);
  }

  async function renderSettings() {
    const notifyFor = new Set(await wd.kv.get('notifyPlatforms', DEFAULT_NOTIFY));
    $('notifyPlatforms').innerHTML = PLATFORMS.map((p) =>
      `<label><input type="checkbox" data-p="${p.id}" ${notifyFor.has(p.id) ? 'checked' : ''}> ${esc(p.label)}</label>`).join('');
    $('includeLoot').checked = await wd.kv.get('includeLoot', false);
    const cc = await wd.kv.get('country', defaultCountry());
    $('country').innerHTML = Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${k === cc ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }

  $('notifyPlatforms').addEventListener('change', async () => {
    const ids = [...document.querySelectorAll('[data-p]')].filter((c) => c.checked).map((c) => c.dataset.p);
    await wd.kv.set('notifyPlatforms', ids);
    wd.ui.toast('Alert preferences saved', 'ok');
  });
  $('includeLoot').onchange = async () => { await wd.kv.set('includeLoot', $('includeLoot').checked); loaded.giveaways = false; loadTab(true); };
  $('country').onchange = async () => { await wd.kv.set('country', $('country').value); await wd.kv.remove('epicCache'); loaded.giveaways = false; loadTab(true); };
  $('settingsBtn').onclick = () => { $('settings').hidden = !$('settings').hidden; };
  $('refresh').onclick = async () => { $('refresh').disabled = true; await loadTab(true); $('refresh').disabled = false; };
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  $('chips').addEventListener('click', (e) => {
    const f = e.target.closest('[data-filter]')?.dataset.filter;
    if (f) { filter = f; renderGiveaways(); }
  });
  $('f2pChips').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f2p]')?.dataset.f2p;
    if (f) { f2pFilter = f; f2pShown = 48; renderF2P(); }
  });
  // Any element with data-open / data-link opens in the system browser (or the store app).
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-open],[data-link]');
    if (!el) return;
    e.preventDefault();
    wd.openUrl(el.dataset.open || el.dataset.link).catch((err) => wd.ui.toast(err.message, 'error'));
  });

  (async () => {
    seen = new Set(await wd.kv.get('seen', []));
    await renderSettings();
    showTab(await wd.kv.get('tab', 'giveaways'));
  })();
})();
