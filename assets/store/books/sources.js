/* Free-library search adapters. Each returns [{source, id, title, author, year, cover, formats?, resolve?}]. */
window.BookSources = (() => {
  const wd = window.webdeck;
  const json = async (url) => { const r = await wd.net.fetch(url, { timeout: 25 }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

  /** Finds downloadable, non-lending files of an Internet Archive item. */
  async function iaFormats(identifier) {
    const meta = await json(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    if (meta.metadata && String(meta.metadata['access-restricted-item']) === 'true') throw new Error('This copy is lending-only on archive.org (borrow it there).');
    const files = (meta.files || []).filter((f) => !f.private);
    const pick = (re) => files.find((f) => re.test(f.name));
    const out = [];
    const epub = pick(/\.epub$/i), pdf = pick(/\.pdf$/i) , txt = pick(/_djvu\.txt$|\.txt$/i);
    const url = (f) => `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(f.name)}`;
    if (epub) out.push({ type: 'epub', url: url(epub), size: +epub.size || 0 });
    if (pdf) out.push({ type: 'pdf', url: url(pdf), size: +pdf.size || 0 });
    if (txt) out.push({ type: 'txt', url: url(txt), size: +txt.size || 0 });
    if (!out.length) throw new Error('No downloadable e-book files in this item.');
    return out;
  }

  const sources = {
    gutenberg: {
      label: 'Project Gutenberg',
      async search(q) {
        const d = await json(`https://gutendex.com/books/?search=${encodeURIComponent(q)}`);
        return d.results.slice(0, 20).map((b) => {
          const f = b.formats || {};
          const formats = [];
          const epub = f['application/epub+zip'];
          if (epub) formats.push({ type: 'epub', url: epub });
          const txt = Object.keys(f).find((k) => k.startsWith('text/plain'));
          if (txt && !/\.zip$/.test(f[txt])) formats.push({ type: 'txt', url: f[txt] });
          return {
            source: 'gutenberg', id: 'pg' + b.id, title: b.title,
            author: (b.authors || []).map((a) => a.name.split(', ').reverse().join(' ')).join(', '),
            year: null, cover: f['image/jpeg'] || null, formats, page: `https://www.gutenberg.org/ebooks/${b.id}`,
            extra: `${(b.download_count || 0).toLocaleString()} downloads`,
          };
        }).filter((b) => b.formats.length);
      },
    },
    standard: {
      label: 'Standard Ebooks',
      async search(q) {
        const r = await wd.net.fetch(`https://standardebooks.org/feeds/opds/all?query=${encodeURIComponent(q)}&per-page=20`, { timeout: 25, headers: { Accept: 'application/atom+xml' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const doc = new DOMParser().parseFromString(r.text, 'application/xml');
        return [...doc.getElementsByTagName('entry')].map((e) => {
          const links = [...e.getElementsByTagName('link')];
          const epub = links.find((l) => /epub\+zip/.test(l.getAttribute('type') || '') && /acquisition/.test(l.getAttribute('rel') || '') && !/kepub|azw|advanced/i.test(l.getAttribute('href') || ''));
          const thumb = links.find((l) => /thumbnail|image/.test(l.getAttribute('rel') || ''));
          const page = links.find((l) => (l.getAttribute('rel') || '') === 'alternate');
          const abs = (h) => (h ? new URL(h, 'https://standardebooks.org').href : null);
          return {
            source: 'standard', id: 'se' + (e.getElementsByTagName('id')[0]?.textContent || Math.random()),
            title: e.getElementsByTagName('title')[0]?.textContent || 'Untitled',
            author: [...e.getElementsByTagName('author')].map((a) => a.getElementsByTagName('name')[0]?.textContent).filter(Boolean).join(', '),
            year: (e.getElementsByTagName('dc:issued')[0]?.textContent || '').slice(0, 4) || null,
            cover: abs(thumb?.getAttribute('href')), page: abs(page?.getAttribute('href')),
            formats: epub ? [{ type: 'epub', url: abs(epub.getAttribute('href')) }] : [],
            extra: 'Carefully formatted edition',
          };
        }).filter((b) => b.formats.length);
      },
    },
    openlibrary: {
      label: 'Open Library',
      async search(q) {
        const d = await json(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,title,author_name,first_publish_year,ia,ebook_access,cover_i&limit=40`);
        return d.docs.filter((b) => b.ebook_access === 'public' && (b.ia || []).length).slice(0, 20).map((b) => ({
          source: 'openlibrary', id: 'ol' + b.key, title: b.title, author: (b.author_name || []).join(', '), year: b.first_publish_year || null,
          cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
          page: `https://openlibrary.org${b.key}`, ia: b.ia, resolve: async () => {
            for (const id of b.ia.slice(0, 4)) { try { return await iaFormats(id); } catch (_) { /* try the next scan */ } }
            throw new Error('No freely downloadable copy found.');
          },
        }));
      },
    },
    archive: {
      label: 'Internet Archive',
      async search(q) {
        const query = `(${q}) AND mediatype:texts AND NOT access-restricted-item:true`;
        const d = await json(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=20&output=json`);
        return d.response.docs.map((b) => ({
          source: 'archive', id: 'ia' + b.identifier, title: Array.isArray(b.title) ? b.title[0] : b.title,
          author: [].concat(b.creator || []).join(', '), year: b.year || null,
          cover: `https://archive.org/services/img/${b.identifier}`, page: `https://archive.org/details/${b.identifier}`,
          extra: b.downloads ? `${(+b.downloads).toLocaleString()} downloads` : '', resolve: () => iaFormats(b.identifier),
        }));
      },
    },
  };
  return { sources };
})();
