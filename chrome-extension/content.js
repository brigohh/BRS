// BRS Comment Library — GRS content script
(function () {
  'use strict';

  const FB_CONFIG = {
    apiKey: "AIzaSyC0WgIWYVqvFHzXZSVo_PJA9VW2UcIqkkg",
    authDomain: "comment-library.firebaseapp.com",
    projectId: "comment-library",
    storageBucket: "comment-library.firebasestorage.app",
    messagingSenderId: "812913785366",
    appId: "1:812913785366:web:a186fa0785c61cbd7f1337"
  };

  const WATCH_IDS = [
    'ddlInfractionType','ddlPlayType','ddlSubPlayType','ddlInfractionRating',
    'ddlModalInfractionType','ddlModalPlayType','ddlModalSubPlayType','ddlModalInfractionRating',
    'ddlModalGTPInfractionType','ddlModalGTPPlayType','ddlModalGTPSubPlayType','ddlModalGTPInfractionRating',
  ];

  let allComments = [], panelVisible = false;
  let filterIT = '', filterPT = '', filterSPT = '', filterIR = '';
  let toast, panel, fab, dot, syncLabel;
  let fetchDone = false;

  // ── Firebase via bundled file ────────────────────────────────────────────
  async function fetchComments() {
    if (fetchDone) return;
    setDot('loading');
    try {
      const { initializeApp, getFirestore, collection, getDocs } = window.FirebaseBundle;
      let app;
      try { app = initializeApp(FB_CONFIG, 'brs-ext'); }
      catch(e) { app = window._brsApp; }
      window._brsApp = app;
      const db = getFirestore(app);
      const snap = await getDocs(collection(db, 'comments'));
      allComments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      fetchDone = true;
      setDot('synced');
      if (syncLabel) syncLabel.textContent = allComments.length + ' comments loaded';
      renderCards();
      syncFromGRS();
    } catch (e) {
      setDot('error');
      if (syncLabel) syncLabel.textContent = 'Connection failed';
      console.warn('[BRS ext] Firestore error:', e);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
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
    const plain = text.replace(/\*\*(.*?)\*\*/g, '$1');
    navigator.clipboard.writeText(plain).then(() => showToast('Copied!')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = plain; ta.style.cssText = 'position:fixed;opacity:0';
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

    // Update active filter pills
    const pillsEl = document.getElementById('brs-active-filters');
    if (pillsEl) {
      const pills = [filterIT, filterPT, filterSPT, filterIR].filter(Boolean);
      pillsEl.innerHTML = pills.length
        ? pills.map(p => `<span class="brs-active-pill">${p.replace(/</g,'&lt;')}</span>`).join('')
        : '<span class="brs-no-filter">No filter — select dropdowns on GRS form</span>';
    }

    if (!allComments.length) {
      body.innerHTML = '<div class="brs-empty">Connecting to comment library…</div>';
      return;
    }
    if (!fc.length) {
      body.innerHTML = '<div class="brs-empty">No comments match this combination.</div>';
      return;
    }
    body.innerHTML = fc.slice(0, 50).map(c => {
      const it = (c.infractionType || 'Foul: Personal').replace(/</g,'&lt;');
      const pt = c.playType ? `<span class="brs-tag">${c.playType.replace(/</g,'&lt;')}</span>` : '';
      const spt = c.subPlayType ? `<span class="brs-tag">${c.subPlayType.replace(/</g,'&lt;')}</span>` : '';
      const ir = c.callType ? `<span class="brs-tag ir">${c.callType.replace(/</g,'&lt;')}</span>` : '';
      const txt = (c.text||'').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>').replace(/</g,'&lt;').replace(/&lt;b&gt;/g,'<b>').replace(/&lt;\/b&gt;/g,'</b>');
      return `<div class="brs-card" data-id="${c.id}">
        <div class="brs-card-tags"><span class="brs-tag it">${it}</span>${pt}${spt}${ir}</div>
        <div class="brs-card-text">${txt}</div>
        <div class="brs-card-hint">Click to copy</div>
      </div>`;
    }).join('');
    body.querySelectorAll('.brs-card').forEach(card => {
      card.addEventListener('click', () => {
        const c = allComments.find(x => x.id === card.dataset.id);
        if (c) copyText(c.text);
      });
    });
  }

  // ── GRS watcher ──────────────────────────────────────────────────────────
  function grsVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  function normalizeIR(val) {
    if (!val) return '';
    const v = val.toLowerCase();
    if (v.includes('lean') && !v.includes('no')) return 'PI - Lean';
    if (v.includes('lean no') || (v.includes('lean') && v.includes('no'))) return 'PI - Lean No';
    if (v.includes('no infraction')) return 'No Infraction';
    if (v.includes('infraction')) return 'Infraction';
    return val;
  }

  function syncFromGRS() {
    const modalOpen = document.querySelector('.modal.show, .modal[style*="display: block"]');
    const prefix = modalOpen ? 'ddlModal' : 'ddl';
    const it = grsVal(prefix + 'InfractionType') || grsVal('ddlInfractionType');
    const pt = grsVal(prefix + 'PlayType') || grsVal('ddlPlayType');
    const spt = grsVal(prefix + 'SubPlayType') || grsVal('ddlSubPlayType');
    const ir = grsVal(prefix + 'InfractionRating') || grsVal('ddlInfractionRating');
    filterIT = (it === 'N/A' || it === '') ? '' : it;
    filterPT = pt;
    filterSPT = spt;
    filterIR = normalizeIR(ir);
    renderCards();
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

  setInterval(attachWatchers, 2000);

  // ── Panel DOM ────────────────────────────────────────────────────────────
  function buildPanel() {
    fab = document.createElement('button');
    fab.id = 'brs-fab';
    fab.title = 'BRS Comment Library';
    fab.textContent = '💬';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);

    toast = document.createElement('div');
    toast.className = 'brs-toast';
    document.body.appendChild(toast);

    panel = document.createElement('div');
    panel.id = 'brs-panel';
    panel.className = 'brs-hidden';
    panel.innerHTML = `
      <div id="brs-header">
        <span id="brs-title">💬 Comment Library</span>
        <div style="display:flex;gap:4px">
          <button class="brs-hbtn" id="brs-refresh" title="Refresh">↻</button>
          <button class="brs-hbtn" id="brs-close">✕</button>
        </div>
      </div>
      <div id="brs-status">
        <span class="brs-dot" id="brs-dot"></span>
        <span id="brs-sync-label">Connecting…</span>
      </div>
      <div id="brs-active-filters">
        <span class="brs-no-filter">Select dropdowns on GRS form to filter</span>
      </div>
      <div id="brs-panel-body"><div class="brs-empty">Loading…</div></div>
    `;
    document.body.appendChild(panel);

    dot = document.getElementById('brs-dot');
    syncLabel = document.getElementById('brs-sync-label');

    document.getElementById('brs-close').addEventListener('click', togglePanel);
    document.getElementById('brs-refresh').addEventListener('click', () => {
      fetchDone = false;
      syncLabel.textContent = 'Refreshing…';
      fetchComments();
    });

    makeDraggable(panel, document.getElementById('brs-header'));
    fetchComments();
  }

  function togglePanel() {
    panelVisible = !panelVisible;
    panel.classList.toggle('brs-hidden', !panelVisible);
    fab.classList.toggle('brs-hidden', panelVisible);
    if (panelVisible) syncFromGRS();
  }

  function makeDraggable(el, handle) {
    let ox=0,oy=0,mx=0,my=0;
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      mx=e.clientX; my=e.clientY;
      const r=el.getBoundingClientRect();
      ox=r.left; oy=r.top;
      el.style.right='auto'; el.style.bottom='auto';
      el.style.left=ox+'px'; el.style.top=oy+'px';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    function onMove(e){ el.style.left=(ox+e.clientX-mx)+'px'; el.style.top=(oy+e.clientY-my)+'px'; }
    function onUp(){ document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
  attachWatchers();
})();
