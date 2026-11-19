/* Price extraction shared by the UI and the background job. */
window.PriceExtract = (() => {
  const CURRENCY_SYMBOLS = [
    ['₹', 'INR'], ['Rs.', 'INR'], ['Rs', 'INR'], ['US$', 'USD'], ['C$', 'CAD'], ['A$', 'AUD'], ['$', 'USD'],
    ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₩', 'KRW'], ['₽', 'RUB'], ['₺', 'TRY'], ['R$', 'BRL'], ['zł', 'PLN'], ['kr', 'SEK'],
  ];

  /** "₹1,23,456.00" / "1.299,95 €" / "$1,299" -> number */
  function parsePrice(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
    const m = String(raw).replace(/[\s  ]/g, '').match(/\d[\d.,']*/);
    if (!m) return null;
    let s = m[0].replace(/'/g, '').replace(/[.,]$/, '');
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
      const commas = (s.match(/,/g) || []).length;
      const decimals = s.length - lastComma - 1;
      s = commas > 1 || decimals === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (lastDot > -1 && (s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function currencyFromText(text) {
    if (!text) return null;
    const t = String(text);
    const code = t.match(/\b(USD|EUR|GBP|INR|JPY|CAD|AUD|CHF|SEK|NOK|DKK|PLN|BRL|MXN|KRW|SGD|HKD|AED)\b/);
    if (code) return code[1];
    for (const [sym, c] of CURRENCY_SYMBOLS) if (t.includes(sym)) return c;
    return null;
  }

  function* walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
    for (const k of ['mainEntity', 'itemOffered', 'hasVariant']) if (node[k]) yield* walk(node[k]);
  }

  const isType = (n, t) => [].concat(n['@type'] || []).some((x) => String(x).toLowerCase() === t.toLowerCase());

  function fromJsonLd(doc) {
    for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(script.textContent.trim()); } catch (_) { continue; }
      for (const node of walk(data)) {
        if (!isType(node, 'Product') && !isType(node, 'Offer') && !isType(node, 'AggregateOffer')) continue;
        const offers = isType(node, 'Product') ? [].concat(node.offers || []) : [node];
        for (const o of offers) {
          const spec = [].concat(o.priceSpecification || [])[0] || {};
          const price = parsePrice(o.price ?? o.lowPrice ?? spec.price);
          if (price) {
            const image = [].concat(node.image || [])[0];
            return {
              price,
              currency: o.priceCurrency || spec.priceCurrency || null,
              title: node.name || null,
              image: typeof image === 'string' ? image : image?.url || null,
              source: 'structured data',
            };
          }
        }
      }
    }
    return null;
  }

  const meta = (doc, ...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
      const v = el?.getAttribute('content');
      if (v) return v.trim();
    }
    return null;
  };

  // Well-known shops whose prices are not in structured data.
  const SITE_SELECTORS = [
    [/amazon\./, ['#corePrice_feature_div .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-offscreen', '#apex_desktop .a-offscreen', '.a-price .a-offscreen', '#priceblock_dealprice', '#priceblock_ourprice']],
    [/flipkart\./, ['div.Nx9bqj', 'div._30jeq3', 'div._16Jk6d']],
    [/ebay\./, ['.x-price-primary .ux-textspans', '[itemprop="price"]']],
    [/bestbuy\./, ['.priceView-customer-price span[aria-hidden="true"]']],
    [/walmart\./, ['[itemprop="price"]', '[data-testid="price-wrap"] span']],
    [/steampowered\./, ['.game_purchase_price', '.discount_final_price']],
  ];
  const GENERIC_SELECTORS = ['[itemprop="price"]', '[data-price]', '[data-product-price]', '.product-price', '.price-current', '.current-price', '.sale-price', '.price'];

  function textOf(el) {
    return (el.getAttribute('content') || el.getAttribute('data-price') || el.getAttribute('data-product-price') || el.textContent || '').trim();
  }

  function isBlocked(html) {
    return /validateCaptcha|captcha-delivery|cf-chl-|Robot Check|Access Denied|unusual traffic|px-captcha/i.test(html.slice(0, 200000));
  }

  /**
   * @returns {{price:number|null,currency:string|null,title:string|null,image:string|null,source:string|null,blocked:boolean}}
   */
  function extract(html, url, selector) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const host = (() => { try { return new URL(url).hostname; } catch (_) { return ''; } })();
    const title = meta(doc, 'og:title', 'twitter:title') || doc.querySelector('h1')?.textContent?.trim() || doc.title || null;
    let image = meta(doc, 'og:image', 'twitter:image');
    let result = null;

    if (selector) {
      try {
        const el = doc.querySelector(selector);
        if (el) {
          const t = textOf(el);
          const price = parsePrice(t);
          if (price) result = { price, currency: currencyFromText(t), source: 'your selector' };
        }
      } catch (_) {
        throw new Error('Invalid CSS selector');
      }
    }
    if (!result) result = fromJsonLd(doc);
    if (!result) {
      const price = parsePrice(meta(doc, 'product:price:amount', 'og:price:amount', 'price', 'twitter:data1'));
      if (price) result = { price, currency: meta(doc, 'product:price:currency', 'og:price:currency', 'priceCurrency'), source: 'page metadata' };
    }
    if (!result) {
      const site = SITE_SELECTORS.find(([re]) => re.test(host));
      for (const sel of [...(site ? site[1] : []), ...GENERIC_SELECTORS]) {
        const el = doc.querySelector(sel);
        if (!el) continue;
        const t = textOf(el);
        const price = parsePrice(t);
        if (price) { result = { price, currency: currencyFromText(t), source: 'page content' }; break; }
      }
    }
    if (image && !/^https?:/i.test(image)) {
      try { image = new URL(image, url).href; } catch (_) { image = null; }
    }
    return {
      price: result?.price ?? null,
      currency: result?.currency || currencyFromText(doc.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content')) || null,
      title: (result?.title || title || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
      image: result?.image || image || null,
      source: result?.source || null,
      blocked: !result && isBlocked(html),
    };
  }

  return { extract, parsePrice, currencyFromText };
})();
