(() => {
  const wd = window.webdeck;
  const esc = wd.ui.escape;
  const C = window.Convert3D;
  const $ = (id) => document.getElementById(id);
  const items = [];

  function render() {
    $('list').innerHTML = items.map((it, i) => {
      const s = it.stats;
      const info = it.error ? `<span style="color:var(--wd-red)">${esc(it.error)}</span>`
        : s ? `${s.vertices.toLocaleString()} vertices · ${s.triangles.toLocaleString()} triangles · ${s.size.map((v) => +v.toFixed(2)).join(' × ')} units` : 'Reading…';
      const target = it.ext === 'obj' ? 'STL' : 'OBJ';
      return `<div class="wd-item"><div class="wd-grow"><div class="wd-ellipsis"><b>${esc(it.file.name)}</b></div><div class="wd-small wd-muted">${info}</div></div>
        ${it.saved ? `<button class="wd-btn wd-btn-sm" data-show="${i}">Show ${target}</button>` : it.mesh ? `<button class="wd-btn wd-btn-primary wd-btn-sm" data-go="${i}">Convert to ${target}</button>` : ''}</div>`;
    }).join('') || '<div class="wd-empty">Choose OBJ or STL files to convert.</div>';
  }

  $('pick').onclick = async () => {
    try {
      const picked = await wd.files.pick({ extensions: ['obj', 'stl'], multiple: true });
      for (const file of picked) {
        const it = { file, ext: file.ext };
        items.push(it);
        render();
        try {
          const buf = await (await fetch(file.url)).arrayBuffer();
          it.mesh = it.ext === 'obj' ? C.parseObj(new TextDecoder().decode(buf)) : C.parseStl(buf);
          it.stats = C.stats(it.mesh);
        } catch (e) { it.error = e.message; }
        render();
      }
    } catch (e) { wd.ui.toast(e.message, 'error'); }
  };

  $('list').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const it = items[+(b.dataset.go ?? b.dataset.show)];
    if (b.dataset.show) return wd.files.reveal(it.saved.path);
    const stem = it.file.name.replace(/\.[^.]+$/, '');
    try {
      if (it.ext === 'obj') {
        const ascii = $('stlfmt').value === 'ascii';
        it.saved = ascii
          ? await wd.files.save({ name: `${stem}.stl`, text: C.writeStlAscii(it.mesh, stem) })
          : await wd.files.save({ name: `${stem}.stl`, blob: new Blob([C.writeStlBinary(it.mesh, stem)]) });
      } else {
        it.saved = await wd.files.save({ name: `${stem}.obj`, text: C.writeObj(it.mesh, stem) });
      }
      wd.ui.toast(`Saved ${it.saved.name}`, 'ok');
    } catch (err) { wd.ui.toast(err.message, 'error'); }
    render();
  };

  render();
})();
