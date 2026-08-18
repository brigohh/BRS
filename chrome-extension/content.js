// BRS Comment Library — GRS content script
// Watches the GRS infraction form dropdowns and surfaces matching comments
// from Firebase Firestore in a floating panel.

(function () {
  'use strict';

  // ── Firebase config (same as comment-library.html) ──────────────────────
  const FB_CONFIG = {
    apiKey: "AIzaSyC0WgIWYVqvFHzXZSVo_PJA9VW2UcIqkkg",
    authDomain: "comment-library.firebaseapp.com",
    projectId: "comment-library",
    storageBucket: "comment-library.firebasestorage.app",
    messagingSenderId: "812913785366",
    appId: "1:812913785366:web:a186fa0785c61cbd7f1337"
  };

  // IDs of the GRS dropdowns we watch (main form + modal variants)
  const WATCH_IDS = [
    'ddlInfractionType', 'ddlPlayType', 'ddlSubPlayType', 'ddlInfractionRating',
    'ddlModalInfractionType', 'ddlModalPlayType', 'ddlModalSubPlayType', 'ddlModalInfractionRating',
    'ddlModalGTPInfractionType', 'ddlModalGTPPlayType', 'ddlModalGTPSubPlayType', 'ddlModalGTPInfractionRating',
  ];

  // ── State ────────────────────────────────────────────────────────────────
  let allComments = [];
  let panelVisible = false;
  let filterIT = '', filterPT = '', filterSPT = '', filterIR = '';
  let toast, panel, fab, dot;

  // ── Firebase (loaded via bundled firebase-bundled.js) ───────────────────
  async function fetchComments() {
    setDot('loading');
    try {
      const { initializeApp, getFirestore, collection, getDocs } = window.FirebaseBundle;
      const app = initializeApp(FB_CONFIG, 'brs-ext');
      const db = getFirestore(app);
      const snap = await getDocs(collection(db, 'comments'));
      allComments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDot('synced');
      renderCards();
    } catch (e) {
      setDot('error');
      console.warn('[BRS ext] Firestore error:', e);
    }
  }

  // ── UI helpers ───────────────────────────────────────────────────────────
  function setDot(state) {
    if (!dot) return;
    dot.className = 'brs-dot ' + (state === 'synced' ? 'synced' : state === 'loading' ? 'loading' : '');
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); showToast('Copied!');
    });
  }

  // ── Filtering ────────────────────────────────────────────────────────────
  function filteredComments() {
    return allComments.filter(c => {
      if (filterIT && (c.infractionType || 'Foul: Personal') !== filterIT) return false;
      if (filterPT && c.playType !== filterPT) return false;
      if (filterSPT && c.subPlayType !== filterSPT) return false;
      if (filterIR && c.callType !== filterIR) return false;
      return true;
    });
  }

  function renderCards() {
    const body = document.getElementById('brs-panel-body');
    if (!body) return;
    const fc = filteredComments();
    if (!fc.length) {
      body.innerHTML = '<div class="brs-empty">' +
        (allComments.length ? 'No comments match these filters.' : 'Loading comments…') +
        '</div>';
      return;
    }
    body.innerHTML = fc.slice(0, 40).map(c => {
      const it = (c.infractionType || 'Foul: Personal').replace(/</g,'&lt;');
      const pt = c.playType ? `<span class="brs-tag">${c.playType.replace(/</g,'&lt;')}</span>` : '';
      const spt = c.subPlayType ? `<span class="brs-tag">${c.subPlayType.replace(/</g,'&lt;')}</span>` : '';
      const ir = c.callType ? `<span class="brs-tag ir">${c.callType.replace(/</g,'&lt;')}</span>` : '';
      const txt = (c.text || '').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/</g,'&lt;').replace(/&lt;b&gt;/g,'<b>').replace(/&lt;\/b&gt;/g,'</b>');
      return `<div class="brs-card" data-id="${c.id}">
        <div class="brs-card-tags"><span class="brs-tag">${it}</span>${pt}${spt}${ir}</div>
        <div class="brs-card-text">${txt}</div>
        <div class="brs-card-copy-hint">Click to copy</div>
      </div>`;
    }).join('');
    body.querySelectorAll('.brs-card').forEach(card => {
      card.addEventListener('click', () => {
        const c = allComments.find(x => x.id === card.dataset.id);
        if (c) copyText(c.text);
      });
    });
  }

  // ── Panel dropdowns (independent from GRS, but also sync from GRS) ───────
  function buildOptions(values, current) {
    return ['', ...values].map(v =>
      `<option value="${v.replace(/"/g,'&quot;')}"${v===current?' selected':''}>${v || '— Any —'}</option>`
    ).join('');
  }

  function uniqueVals(key) {
    return [...new Set(allComments.map(c => c[key]).filter(Boolean))].sort();
  }

  function refreshPanelDropdowns() {
    const itSel = document.getElementById('brs-sel-it');
    const ptSel = document.getElementById('brs-sel-pt');
    const sptSel = document.getElementById('brs-sel-spt');
    const irSel = document.getElementById('brs-sel-ir');
    if (!itSel) return;
    itSel.innerHTML = buildOptions(uniqueVals('infractionType'), filterIT);
    ptSel.innerHTML = buildOptions(uniqueVals('playType'), filterPT);
    sptSel.innerHTML = buildOptions(uniqueVals('subPlayType'), filterSPT);
    irSel.innerHTML = buildOptions(['Infraction','PI - Lean','PI - Lean No','No Infraction','Assessment Error'], filterIR);
  }

  // ── GRS dropdown watcher ─────────────────────────────────────────────────
  function grsVal(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  function syncFromGRS() {
    // Prefer modal values if a modal is visible, else main form
    const modalOpen = document.querySelector('.modal.show, .modal[style*="display: block"]');
    const prefix = modalOpen ? 'ddlModal' : 'ddl';
    const it = grsVal(prefix + 'InfractionType') || grsVal('ddlInfractionType');
    const pt = grsVal(prefix + 'PlayType') || grsVal('ddlPlayType');
    const spt = grsVal(prefix + 'SubPlayType') || grsVal('ddlSubPlayType');
    const ir = grsVal(prefix + 'InfractionRating') || grsVal('ddlInfractionRating');
    filterIT = it === 'N/A' ? '' : it;
    filterPT = pt;
    filterSPT = spt;
    filterIR = normalizeIR(ir);
    refreshPanelDropdowns();
    renderCards();
  }

  function normalizeIR(val) {
    if (!val) return '';
    if (val.toLowerCase().includes('lean infraction')) return 'PI - Lean';
    if (val.toLowerCase().includes('lean no')) return 'PI - Lean No';
    if (val.toLowerCase().includes('no infraction')) return 'No Infraction';
    if (val.toLowerCase().includes('infraction')) return 'Infraction';
    return val;
  }

  function attachWatchers() {
    WATCH_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._brsWatched) {
        el.addEventListener('change', syncFromGRS);
        el._brsWatched = true;
      }
    });
  }

  // Re-attach watchers periodically in case the GRS page loads dropdowns dynamically
  setInterval(attachWatchers, 2000);

  // ── Build panel DOM ───────────────────────────────────────────────────────
  function buildPanel() {
    // FAB
    fab = document.createElement('button');
    fab.id = 'brs-fab';
    fab.title = 'BRS Comment Library';
    fab.innerHTML = '💬';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    // Toast
    toast = document.createElement('div');
    toast.className = 'brs-toast';
    document.body.appendChild(toast);

    // Panel
    panel = document.createElement('div');
    panel.id = 'brs-panel';
    panel.className = 'brs-hidden';
    panel.innerHTML = `
      <div id="brs-panel-header">
        <span>💬 Comment Library</span>
        <div id="brs-panel-header-right">
          <button class="brs-icon-btn" id="brs-refresh-btn" title="Refresh from Firebase">↻</button>
          <button class="brs-icon-btn" id="brs-close-btn" title="Close">✕</button>
        </div>
      </div>
      <div id="brs-sync-indicator">
        <span class="brs-dot" id="brs-dot"></span>
        <span id="brs-sync-label">Connecting…</span>
      </div>
      <div id="brs-panel-filters">
        <div class="brs-filter-row">
          <label>IT</label>
          <select id="brs-sel-it"><option value="">— Any —</option></select>
        </div>
        <div class="brs-filter-row">
          <label>PT</label>
          <select id="brs-sel-pt"><option value="">— Any —</option></select>
        </div>
        <div class="brs-filter-row">
          <label>SPT</label>
          <select id="brs-sel-spt"><option value="">— Any —</option></select>
        </div>
        <div class="brs-filter-row">
          <label>IR</label>
          <select id="brs-sel-ir"><option value="">— Any —</option></select>
        </div>
      </div>
      <div id="brs-panel-body"><div class="brs-empty">Loading comments…</div></div>
    `;
    document.body.appendChild(panel);

    dot = document.getElementById('brs-dot');
    const syncLabel = document.getElementById('brs-sync-label');

    document.getElementById('brs-close-btn').addEventListener('click', togglePanel);
    document.getElementById('brs-refresh-btn').addEventListener('click', () => {
      syncLabel.textContent = 'Refreshing…';
      fetchComments().then(() => { syncLabel.textContent = allComments.length + ' comments loaded'; });
    });

    // Panel filter changes (manual override)
    ['brs-sel-it','brs-sel-pt','brs-sel-spt','brs-sel-ir'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        filterIT = document.getElementById('brs-sel-it').value;
        filterPT = document.getElementById('brs-sel-pt').value;
        filterSPT = document.getElementById('brs-sel-spt').value;
        filterIR = document.getElementById('brs-sel-ir').value;
        renderCards();
      });
    });

    // Drag
    makeDraggable(panel, document.getElementById('brs-panel-header'));

    fetchComments().then(() => {
      if (syncLabel) syncLabel.textContent = allComments.length + ' comments loaded';
      refreshPanelDropdowns();
      syncFromGRS();
    });
  }

  function togglePanel() {
    panelVisible = !panelVisible;
    panel.classList.toggle('brs-hidden', !panelVisible);
    fab.classList.toggle('brs-hidden', panelVisible);
    if (panelVisible) { refreshPanelDropdowns(); syncFromGRS(); }
  }

  // ── Draggable ─────────────────────────────────────────────────────────────
  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      mx = e.clientX; my = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      el.style.right = 'auto'; el.style.bottom = 'auto';
      el.style.left = ox + 'px'; el.style.top = oy + 'px';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    function onMove(e) {
      el.style.left = (ox + e.clientX - mx) + 'px';
      el.style.top  = (oy + e.clientY - my) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
  attachWatchers();

})();
