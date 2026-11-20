(() => {
  const wd = window.webdeck;
  const esc = (s) => (s ? String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]) : '');
  const $ = (id) => document.getElementById(id);
  const collection = wd.db.collection('notes');

  let notes = [];
  let currentNote = null;
  let saveTimeout = null;
  let searchQuery = '';

  const SAMPLE_NOTE = {
    title: 'Welcome to WebDeck Notes',
    content: `# WebDeck Notes
Your local, fast, offline markdown workspace.

### Features:
- [x] Auto-saves every keystroke
- [x] Checklists & Markdown formatting
- [x] Tag by colors (Yellow, Blue, Green, Pink, Purple)
- [ ] Export directly to .md files

### Quick Code Example:
\`\`\`javascript
const deck = window.webdeck;
deck.ui.toast('Hello from WebDeck!', 'ok');
\`\`\`
`,
    color: '#EAB308',
    updatedAt: new Date().toISOString()
  };

  async function init() {
    bindEvents();
    await loadNotes();
  }

  function bindEvents() {
    $('btnNewNote').onclick = createNewNote;
    $('btnDeleteNote').onclick = deleteCurrentNote;
    $('btnExportMd').onclick = exportCurrentNote;

    $('noteTitle').oninput = triggerAutoSave;
    $('noteContent').oninput = triggerAutoSave;
    $('noteColorSelect').onchange = triggerAutoSave;

    $('searchInput').oninput = (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderList();
    };
  }

  async function loadNotes() {
    notes = await collection.find(null, { sort: '-updatedAt' });
    if (notes.length === 0) {
      const doc = await collection.insert(SAMPLE_NOTE);
      notes = [doc];
    }
    currentNote = notes[0];
    renderList();
    loadIntoEditor(currentNote);
  }

  function renderList() {
    const filtered = notes.filter(n => {
      if (!searchQuery) return true;
      return (n.title || '').toLowerCase().includes(searchQuery) ||
             (n.content || '').toLowerCase().includes(searchQuery);
    });

    $('notesList').innerHTML = filtered.map(n => {
      const isActive = currentNote && currentNote._id === n._id;
      const snippet = (n.content || '').replace(/[#*`\-[\]]/g, '').trim().slice(0, 80);
      return `
        <div class="note-item ${isActive ? 'active' : ''}" style="border-left-color:${n.color || '#EAB308'}" data-note-id="${esc(n._id)}">
          <div class="note-title">${esc(n.title || 'Untitled Note')}</div>
          <div class="note-snippet">${esc(snippet || 'No additional text')}</div>
        </div>
      `;
    }).join('');

    document.querySelectorAll('[data-note-id]').forEach(el => {
      el.onclick = () => {
        const n = notes.find(x => x._id === el.dataset.noteId);
        if (n) {
          currentNote = n;
          loadIntoEditor(n);
          renderList();
        }
      };
    });
  }

  function loadIntoEditor(note) {
    $('noteTitle').value = note.title || '';
    $('noteContent').value = note.content || '';
    $('noteColorSelect').value = note.color || '#EAB308';
  }

  function triggerAutoSave() {
    if (!currentNote) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      currentNote.title = $('noteTitle').value.trim() || 'Untitled Note';
      currentNote.content = $('noteContent').value;
      currentNote.color = $('noteColorSelect').value;
      currentNote.updatedAt = new Date().toISOString();

      await collection.update(currentNote._id, {
        title: currentNote.title,
        content: currentNote.content,
        color: currentNote.color,
        updatedAt: currentNote.updatedAt
      });
      renderList();
    }, 400);
  }

  async function createNewNote() {
    const newNote = {
      title: 'Untitled Note',
      content: '',
      color: '#388BFD',
      updatedAt: new Date().toISOString()
    };
    const saved = await collection.insert(newNote);
    notes.unshift(saved);
    currentNote = saved;
    renderList();
    loadIntoEditor(saved);
    $('noteTitle').focus();
    $('noteTitle').select();
  }

  async function deleteCurrentNote() {
    if (!currentNote) return;
    if (!confirm(`Delete note "${currentNote.title}"?`)) return;
    await collection.remove(currentNote._id);
    notes = notes.filter(n => n._id !== currentNote._id);
    currentNote = notes[0] || null;
    renderList();
    if (currentNote) loadIntoEditor(currentNote);
    else {
      $('noteTitle').value = '';
      $('noteContent').value = '';
    }
    wd.ui.toast('Note deleted', 'ok');
  }

  function exportCurrentNote() {
    if (!currentNote) return;
    const blob = new Blob([currentNote.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(currentNote.title || 'Note').replace(/[\\/:*?"<>|]/g, '')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    wd.ui.toast('Exported note as .md', 'ok');
  }

  init();
})();
