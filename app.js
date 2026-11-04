/* ═══════════════════════════════════════════════
   MUDWATER BINDER — app.js
   Three collection types: Boxes · Packs · Cards
   Read-only wallet. No transactions.
═══════════════════════════════════════════════ */
'use strict';

// ── CONFIG ──────────────────────────────────────
const COLLECTIONS = {
  cards: { symbol: 'mudwater_cards', label: 'Cards',  icon: '🎴', color: '#c9a84c', floorSol: 0.0094 },
  packs: { symbol: 'mudwater_packs', label: 'Packs',  icon: '🃏', color: '#7dd3fc', floorSol: 0.6857 },
  boxes: { symbol: 'mudwater_boxes', label: 'Boxes',  icon: '📦', color: '#c084fc', floorSol: 17.05  },
};
// All ME requests go through our CF Worker proxy (adds CORS headers)
const ME_API    = 'https://mudwater-proxy.saintsola13.workers.dev/proxy';
const ME_ITEM   = addr => `https://magiceden.us/item-details/${addr}`;
const STORE_PRO = 'mudwater_profiles';
const STORE_COL = 'mudwater_collectors';

// ── STATE ───────────────────────────────────────
const state = {
  connected: false,
  wallet:    null,
  viewingWallet: null,
  activeTab: 'cards',
  data: { cards: [], packs: [], boxes: [] },
  filtered: [],
  view: 'grid',
  page: 'home',
};

const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ═══════════════════════════════════════════════
//   BACKGROUND CANVAS — spinning coins
// ═══════════════════════════════════════════════
(function bgCanvas() {
  const canvas = $('bgCanvas');
  const ctx    = canvas.getContext('2d');
  const coins  = [];

  function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
  resize();
  addEventListener('resize', resize);

  for (let i = 0; i < 22; i++) {
    coins.push({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: 18 + Math.random() * 60,
      speed: .002 + Math.random() * .006,
      angle: Math.random() * Math.PI * 2,
      dx: (Math.random() - .5) * .25,
      dy: (Math.random() - .5) * .25,
    });
  }

  (function loop(ts) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t = ts * .001;
    coins.forEach(c => {
      const sx = Math.cos(c.angle + t * c.speed);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(sx, 1);
      ctx.beginPath(); ctx.arc(0,0,c.r,0,Math.PI*2);
      ctx.strokeStyle='#c9a84c'; ctx.lineWidth=2.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(0,0,c.r*.72,0,Math.PI*2);
      ctx.strokeStyle='#c9a84c'; ctx.lineWidth=1; ctx.globalAlpha=.4; ctx.stroke(); ctx.globalAlpha=1;
      ctx.font=`${c.r*.6}px serif`; ctx.fillStyle='#c9a84c';
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('꩜',0,0);
      ctx.restore();
      c.x+=c.dx; c.y+=c.dy;
      if(c.x<-c.r*2) c.x=canvas.width+c.r;
      if(c.x>canvas.width+c.r*2) c.x=-c.r;
      if(c.y<-c.r*2) c.y=canvas.height+c.r;
      if(c.y>canvas.height+c.r*2) c.y=-c.r;
    });
    requestAnimationFrame(loop);
  })(0);
})();

// ═══════════════════════════════════════════════
//   PAGES
// ═══════════════════════════════════════════════
function showPage(name) {
  state.page = name;
  $('pageHome').classList.toggle('hidden',   name !== 'home');
  $('pageBinder').classList.toggle('hidden', name !== 'binder');
  $('pageSearch').classList.toggle('hidden', name !== 'search');
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  if (name === 'home')   $('navHome').classList.add('active');
  if (name === 'binder') $('navBinder').classList.add('active');
  if (name === 'search') $('navSearch').classList.add('active');
  scrollTo({ top: 0, behavior: 'smooth' });
}

$('navHome').addEventListener('click', e => { e.preventDefault(); showPage('home'); });
$('navBinder').addEventListener('click', e => {
  e.preventDefault();
  if (!state.connected) { toast('Connect your wallet first', 'error'); return; }
  showPage('binder');
  state.viewingWallet = state.wallet;
  loadBinder(state.wallet);
});
$('navSearch').addEventListener('click', e => { e.preventDefault(); showPage('search'); renderCollectors(); });
$('heroBrowse').addEventListener('click', () => { showPage('search'); renderCollectors(); });

// ═══════════════════════════════════════════════
//   WALLET
// ═══════════════════════════════════════════════
async function connectWallet() {
  try {
    let pubkey = null;
    if (window.phantom?.solana?.isPhantom) {
      const r = await window.phantom.solana.connect({ onlyIfTrusted: false });
      pubkey = r.publicKey.toBase58();
    } else if (window.solflare?.isSolflare) {
      await window.solflare.connect();
      pubkey = window.solflare.publicKey.toBase58();
    } else {
      pubkey = prompt('No wallet extension found.\n\nPaste your Solana address (read-only view):')?.trim() || null;
    }
    if (!pubkey) return;
    setWallet(pubkey);
  } catch(err) {
    console.error(err);
    toast('Could not connect wallet', 'error');
  }
}

function setWallet(pubkey) {
  state.connected = true;
  state.wallet    = pubkey;
  $('btnConnect').classList.add('hidden');
  $('walletInfo').classList.remove('hidden');
  $('walletAddr').textContent = short(pubkey);
  const profiles = getProfiles();
  if (!profiles[pubkey]) {
    openProfileModal(false);
  } else {
    goToBinder(pubkey);
  }
}

$('btnConnect').addEventListener('click', connectWallet);
$('heroConnect').addEventListener('click', connectWallet);
$('btnDisconnect').addEventListener('click', () => {
  state.connected = false; state.wallet = null;
  $('btnConnect').classList.remove('hidden');
  $('walletInfo').classList.add('hidden');
  showPage('home');
});

function goToBinder(pubkey) {
  showPage('binder');
  state.viewingWallet = pubkey;
  loadBinder(pubkey);
}

// ═══════════════════════════════════════════════
//   PROFILE + PFP
// ═══════════════════════════════════════════════
function getProfiles() {
  try { return JSON.parse(localStorage.getItem(STORE_PRO) || '{}'); } catch { return {}; }
}
function saveProfiles(obj) { localStorage.setItem(STORE_PRO, JSON.stringify(obj)); }

// PFP state
let _pendingPfp = null; // base64 data URL

function openProfileModal(prefill) {
  const p = getProfiles()[state.wallet] || {};
  $('profileName').value    = prefill ? (p.name    || '') : '';
  $('profileTwitter').value = prefill ? (p.twitter || '') : '';
  $('profileBio').value     = prefill ? (p.bio     || '') : '';
  _pendingPfp = null;

  // render pfp preview
  const preview = $('pfpPreview');
  if (p.pfp) {
    preview.style.backgroundImage = `url(${p.pfp})`;
    preview.textContent = '';
  } else {
    preview.style.backgroundImage = '';
    preview.textContent = getEmoji(state.wallet || 'x');
  }

  $('profileModal').classList.remove('hidden');
}

// PFP upload click
$('pfpPickBtn').addEventListener('click', () => $('pfpFileInput').click());

$('pfpFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('Image must be under 2 MB', 'error'); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    _pendingPfp = ev.target.result;
    const preview = $('pfpPreview');
    preview.style.backgroundImage = `url(${_pendingPfp})`;
    preview.textContent = '';
  };
  reader.readAsDataURL(file);
  e.target.value = ''; // reset so same file can be re-picked
});

$('saveProfile').addEventListener('click', () => {
  const name = $('profileName').value.trim();
  if (!name) { toast('Enter a display name', 'error'); return; }
  const profiles = getProfiles();
  const existing = profiles[state.wallet] || {};
  profiles[state.wallet] = {
    ...existing,
    name,
    twitter: $('profileTwitter').value.trim(),
    bio:     $('profileBio').value.trim(),
    pfp:     _pendingPfp !== null ? _pendingPfp : (existing.pfp || null),
  };
  saveProfiles(profiles);
  $('profileModal').classList.add('hidden');
  goToBinder(state.wallet);
});

$('skipProfile').addEventListener('click', () => {
  $('profileModal').classList.add('hidden');
  goToBinder(state.wallet);
});

$('editProfile').addEventListener('click', () => openProfileModal(true));

// ═══════════════════════════════════════════════
//   BINDER TABS
// ═══════════════════════════════════════════════
$$('.binder-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.binder-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.activeTab = tab.dataset.tab;
    $('filterRarity').classList.toggle('hidden', state.activeTab !== 'cards');
    applyFilters();
  });
});

// ═══════════════════════════════════════════════
//   FETCH — paginated wallet tokens
// ═══════════════════════════════════════════════
async function fetchAllTokensForWallet(wallet) {
  const all    = [];
  const limit  = 500;
  let   offset = 0;
  let   page;

  do {
    const url = `${ME_API}/wallets/${encodeURIComponent(wallet)}/tokens?offset=${offset}&limit=${limit}`;
    const r   = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      console.warn(`ME wallet tokens HTTP ${r.status} at offset ${offset}`);
      break;
    }
    page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    all.push(...page);
    offset += page.length;
  } while (page.length === limit); // keep going only if we got a full page

  return all;
}

async function loadBinder(wallet) {
  renderBinderHeader(wallet);

  // reset
  ['Cards','Packs','Boxes'].forEach(t => $(`tabCount${t}`).textContent = '0');
  ['numBoxes','numPacks','numCards','numValue'].forEach(id => $(id).textContent = '—');
  $('cardGrid').innerHTML = '';
  $('emptyCards').classList.add('hidden');
  $('loadingCards').classList.remove('hidden');

  let allTokens = [];
  try {
    allTokens = await fetchAllTokensForWallet(wallet);
  } catch(err) {
    console.error('Fetch error:', err);
    $('loadingCards').classList.add('hidden');
    toast('Error fetching wallet. Check the address.', 'error');
    return;
  }

  // filter into buckets by exact collection symbol
  const cards = allTokens.filter(t => t.collection === 'mudwater_cards');
  const packs = allTokens.filter(t => t.collection === 'mudwater_packs');
  const boxes = allTokens.filter(t => t.collection === 'mudwater_boxes');

  state.data = { cards, packs, boxes };
  $('loadingCards').classList.add('hidden');

  // tab counts
  $('tabCountCards').textContent = cards.length;
  $('tabCountPacks').textContent = packs.length;
  $('tabCountBoxes').textContent = boxes.length;

  // totals row
  $('numCards').textContent = cards.length;
  $('numPacks').textContent = packs.length;
  $('numBoxes').textContent = boxes.length;
  const floorVal =
    cards.length * COLLECTIONS.cards.floorSol +
    packs.length * COLLECTIONS.packs.floorSol +
    boxes.length * COLLECTIONS.boxes.floorSol;
  $('numValue').textContent = `${floorVal.toFixed(2)} SOL`;

  // cache collector
  const total = cards.length + packs.length + boxes.length;
  if (total > 0) cacheCollector(wallet, getProfiles()[wallet] || {}, { cards: cards.length, packs: packs.length, boxes: boxes.length });

  applyFilters();
}

// ═══════════════════════════════════════════════
//   BINDER HEADER
// ═══════════════════════════════════════════════
function renderBinderHeader(wallet) {
  const p     = getProfiles()[wallet] || {};
  const isOwn = wallet === state.wallet;

  $('binderName').textContent        = p.name || short(wallet);
  $('binderWalletShort').textContent = short(wallet);

  // avatar — pfp image or emoji fallback
  const av = $('binderAvatar');
  if (p.pfp) {
    av.style.backgroundImage = `url(${p.pfp})`;
    av.style.backgroundSize  = 'cover';
    av.style.backgroundPosition = 'center';
    av.textContent = '';
  } else {
    av.style.backgroundImage = '';
    av.textContent = getEmoji(wallet);
  }

  if (p.twitter) {
    $('binderTwitter').textContent = `@${p.twitter.replace('@','')}`;
    $('binderTwitter').classList.remove('hidden');
  } else { $('binderTwitter').classList.add('hidden'); }

  if (p.bio) {
    $('binderBio').textContent = p.bio;
    $('binderBio').classList.remove('hidden');
  } else { $('binderBio').classList.add('hidden'); }

  $('editProfile').classList.toggle('hidden', !isOwn);
  $('btnDownload').classList.toggle('hidden', !isOwn);
}

// ═══════════════════════════════════════════════
//   FILTERS & RENDER
// ═══════════════════════════════════════════════
function applyFilters() {
  const tab  = state.activeTab;
  const q    = $('searchItems').value.toLowerCase().trim();
  const rar  = $('filterRarity').value;
  let items  = [...(state.data[tab] || [])];

  if (q) items = items.filter(i => (i.name||'').toLowerCase().includes(q));
  if (tab === 'cards' && rar !== 'all') {
    items = items.filter(i => getRarity(i) === rar);
  }
  state.filtered = items;
  renderGrid(items, tab);
}

$('searchItems').addEventListener('input', applyFilters);
$('filterRarity').addEventListener('change', applyFilters);
$('viewGrid').addEventListener('click', () => {
  state.view = 'grid';
  $('viewGrid').classList.add('active');
  $('viewList').classList.remove('active');
  renderGrid(state.filtered, state.activeTab);
});
$('viewList').addEventListener('click', () => {
  state.view = 'list';
  $('viewList').classList.add('active');
  $('viewGrid').classList.remove('active');
  renderGrid(state.filtered, state.activeTab);
});

function renderGrid(items, tab) {
  const grid = $('cardGrid');
  grid.innerHTML = '';
  $('emptyCards').classList.toggle('hidden', items.length > 0);
  if (!items.length) return;

  const col = COLLECTIONS[tab];
  items.forEach(item => {
    const rarity = tab === 'cards' ? getRarity(item) : tab;
    const div    = document.createElement('div');
    div.className = `card-item type-${tab}${tab === 'cards' ? ' ' + rarity : ''}`;

    const imgSrc = item.image || '';
    const imgHtml = imgSrc
      ? `<img src="${imgSrc}" alt="${esc(item.name)}" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="card-placeholder">${col.icon}</div>`;

    const badgeClass = tab === 'cards' ? `badge-${rarity}` : (tab === 'packs' ? 'badge-pack' : 'badge-box');
    const badgeLabel = tab === 'cards' ? rarityLabel(rarity) : col.label;

    div.innerHTML = `
      <div class="card-img-wrap">
        ${imgHtml}
        <div class="card-rarity-badge ${badgeClass}">${badgeLabel}</div>
      </div>
      <div class="card-info">
        <div class="card-name">${esc(item.name || `Mudwater ${col.label}`)}</div>
        ${serialText(item) ? `<div class="card-serial-txt">${serialText(item)}</div>` : ''}
      </div>
    `;
    div.addEventListener('click', () => openCardModal(item, tab));
    grid.appendChild(div);
  });

  grid.className = `card-grid${state.view === 'list' ? ' list-view' : ''}`;
}

// ═══════════════════════════════════════════════
//   CARD MODAL
// ═══════════════════════════════════════════════
function openCardModal(item, tab) {
  const col    = COLLECTIONS[tab];
  const rarity = tab === 'cards' ? getRarity(item) : tab;

  $('cardModalType').textContent   = `Mudwater ${col.label}`;
  $('cardModalType').style.color   = col.color;
  $('cardModalRarity').textContent = tab === 'cards' ? rarityLabel(rarity) : '';
  $('cardModalRarity').style.color = rarityColor(rarity);
  $('cardModalName').textContent   = item.name || `Mudwater ${col.label}`;
  $('cardModalSerial').textContent = serialText(item) || '';
  $('cardModalME').href = item.mintAddress
    ? ME_ITEM(item.mintAddress)
    : `https://magiceden.us/marketplace/${col.symbol}`;

  $('cardModalImgWrap').innerHTML = item.image
    ? `<img src="${item.image}" alt="${esc(item.name)}" />`
    : `<div style="padding:60px;text-align:center;font-size:48px;color:${col.color}">${col.icon}</div>`;

  const attrs = item.attributes || item.traits || [];
  $('cardModalAttrs').innerHTML = attrs.length
    ? attrs.map(a => `
        <div class="attr-row">
          <span class="attr-key">${esc(a.trait_type||a.key||'')}</span>
          <span class="attr-val">${esc(String(a.value||''))}</span>
        </div>`).join('')
    : `<div class="attr-row"><span class="attr-key">Collection</span><span class="attr-val">Mudwater Swamp Origins</span></div>`;

  $('cardModal').classList.remove('hidden');
}

$('closeCardModal').addEventListener('click', () => $('cardModal').classList.add('hidden'));
$('cardModal').addEventListener('click', e => { if (e.target === $('cardModal')) $('cardModal').classList.add('hidden'); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('cardModal').classList.add('hidden'); });

// ═══════════════════════════════════════════════
//   SHARE
// ═══════════════════════════════════════════════
$('btnShare').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}?wallet=${state.viewingWallet}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => toast('Binder link copied! 🔗', 'success'));
  } else {
    prompt('Copy this link:', url);
  }
});

// ═══════════════════════════════════════════════
//   DOWNLOAD — cinematic binder flip
// ═══════════════════════════════════════════════
$('btnDownload').addEventListener('click', downloadBinder);

async function downloadBinder() {
  const tab   = state.activeTab;
  const all   = state.data[tab] || [];
  const items = all.slice(0, 50);
  if (!items.length) { toast('No items to download', 'error'); return; }

  // ── progress overlay ──────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'dlOverlay';
  overlay.innerHTML = `
    <div class="dl-box">
      <div class="dl-logo">꩜</div>
      <div class="dl-title">RENDERING BINDER</div>
      <div class="dl-bar-wrap"><div class="dl-bar" id="dlBar"></div></div>
      <div class="dl-status" id="dlStatus">Loading images…</div>
      <div class="dl-cancel" id="dlCancel">Cancel</div>
    </div>`;
  document.body.appendChild(overlay);
  let cancelled = false;
  document.getElementById('dlCancel').addEventListener('click', () => {
    cancelled = true;
    overlay.remove();
  });

  const setProgress = (pct, msg) => {
    if (!document.getElementById('dlBar')) return;
    document.getElementById('dlBar').style.width = pct + '%';
    document.getElementById('dlStatus').textContent = msg;
  };

  // ── canvas setup ─────────────────────────────
  const W = 1080, H = 1080; // square — perfect for socials
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // ── preload images ────────────────────────────
  const imgMap = {};
  for (let i = 0; i < items.length; i++) {
    if (cancelled) return;
    const item = items[i];
    setProgress((i / items.length) * 30, `Loading images… ${i+1}/${items.length}`);
    if (!item.image) continue;
    await new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { imgMap[item.image] = img; res(); };
      img.onerror = () => res();
      setTimeout(() => res(), 4000); // timeout guard
      img.src = item.image;
    });
  }
  if (cancelled) return;

  // ── particles system ─────────────────────────
  const particles = [];
  function spawnParticles(cx, cy, color) {
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12 + Math.random() * .5;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 1, decay: .04 + Math.random() * .03,
        r: 2 + Math.random() * 4,
        color,
      });
    }
  }
  function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += .15; // gravity
      p.life -= p.decay;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── spinning coin bg ─────────────────────────
  let coinAngle = 0;
  function drawBg(t) {
    // deep swamp gradient
    const grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W*.7);
    grad.addColorStop(0,   '#131a0d');
    grad.addColorStop(0.6, '#0a0b08');
    grad.addColorStop(1,   '#050605');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // subtle diagonal grid
    ctx.strokeStyle = 'rgba(201,168,76,0.03)';
    ctx.lineWidth = 1;
    for (let x = -H; x < W + H; x += 48) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - H, H); ctx.stroke();
    }

    // large bg coin watermark
    coinAngle += .008;
    const coinSx = Math.cos(coinAngle);
    ctx.save();
    ctx.translate(W/2, H/2);
    ctx.scale(coinSx, 1);
    ctx.globalAlpha = .04;
    ctx.strokeStyle = '#c9a84c';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 320, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 240, 0, Math.PI*2); ctx.stroke();
    ctx.font = '200px serif';
    ctx.fillStyle = '#c9a84c';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('꩜', 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── rounded rect helper ───────────────────────
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  // ── shadow helper ─────────────────────────────
  function withShadow(color, blur, fn) {
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    fn();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  }

  // ── draw single card ─────────────────────────
  const col = COLLECTIONS[tab];
  const CW = tab === 'cards' ? 170 : 220;
  const CH = tab === 'cards' ? 238 : 146;

  function drawCard(item, cx, cy, flipPhase, scale = 1) {
    // flipPhase 0=back, 1=face
    const sx = Math.abs(Math.cos((1 - flipPhase) * Math.PI)) * scale;
    const sy = scale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);

    const rarity = tab === 'cards' ? getRarity(item) : tab;
    const img    = item.image && imgMap[item.image];

    if (flipPhase >= .5) {
      // ── FACE ──
      // card shadow
      withShadow('rgba(0,0,0,0.9)', 24, () => {
        rrect(-CW/2, -CH/2, CW, CH, 10);
        ctx.fillStyle = '#1c2014'; ctx.fill();
      });

      // image
      if (img) {
        ctx.save(); ctx.beginPath();
        rrect(-CW/2, -CH/2, CW, CH, 10);
        ctx.clip();
        ctx.drawImage(img, -CW/2, -CH/2, CW, CH);
        ctx.restore();
      } else {
        rrect(-CW/2, -CH/2, CW, CH, 10);
        const fbg = ctx.createLinearGradient(-CW/2,-CH/2,CW/2,CH/2);
        fbg.addColorStop(0,'#1c2014'); fbg.addColorStop(1,'#131a0d');
        ctx.fillStyle = fbg; ctx.fill();
        ctx.font = `${CW*.35}px serif`; ctx.fillStyle = col.color;
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(col.icon, 0, 0);
      }

      // foil overlay
      if (rarity === 'foil' || rarity === 'cracked-ice') {
        const shimmerPhase = (Date.now() * .001) % 1;
        const gr = ctx.createLinearGradient(
          -CW/2 + shimmerPhase * CW * 2, -CH/2,
          -CW/2 + shimmerPhase * CW * 2 + CW, CH/2
        );
        gr.addColorStop(0,   'rgba(192,132,252,0)');
        gr.addColorStop(0.3, 'rgba(192,132,252,0.35)');
        gr.addColorStop(0.5, 'rgba(125,211,252,0.4)');
        gr.addColorStop(0.7, 'rgba(52,211,153,0.35)');
        gr.addColorStop(1,   'rgba(251,191,36,0)');
        ctx.save(); rrect(-CW/2,-CH/2,CW,CH,10); ctx.clip();
        ctx.fillStyle = gr; ctx.fill();
        ctx.restore();
      }

      // border glow
      const borderColor = rarity === 'foil' ? '#c084fc'
        : rarity === 'cracked-ice' ? '#7dd3fc'
        : rarity === 'serialized'  ? '#f59e0b'
        : col.color;
      withShadow(borderColor, 16, () => {
        rrect(-CW/2, -CH/2, CW, CH, 10);
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = rarity === 'standard' ? 1.5 : 2.5;
        ctx.stroke();
      });

      // rarity ribbon
      if (rarity !== 'standard') {
        ctx.save();
        ctx.translate(CW/2 - 2, -CH/2 + 2);
        ctx.rotate(Math.PI/4);
        ctx.fillStyle = borderColor;
        ctx.globalAlpha = .9;
        ctx.fillRect(-28, -6, 56, 12);
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      // card name label at bottom
      const label = (item.name || col.label).substring(0, 22);
      const labelH = 32;
      const labelY = CH/2 - labelH;
      ctx.save();
      rrect(-CW/2, labelY, CW, labelH + 10, 10); // bottom mask
      ctx.beginPath(); ctx.rect(-CW/2, labelY, CW, labelH + 10);
      const lgrad = ctx.createLinearGradient(0, labelY, 0, labelY + labelH);
      lgrad.addColorStop(0, 'rgba(0,0,0,0)'); lgrad.addColorStop(1, 'rgba(0,0,0,0.85)');
      ctx.fillStyle = lgrad; ctx.fill();
      ctx.restore();
      ctx.font = `bold ${CW * .085}px sans-serif`;
      ctx.fillStyle = '#e8e4d8';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(label, 0, CH/2 - 6);

    } else {
      // ── BACK ──
      withShadow('rgba(0,0,0,0.8)', 20, () => {
        rrect(-CW/2, -CH/2, CW, CH, 10);
        const backGrad = ctx.createLinearGradient(-CW/2,-CH/2,CW/2,CH/2);
        backGrad.addColorStop(0, '#1c2014');
        backGrad.addColorStop(1, '#0f1309');
        ctx.fillStyle = backGrad; ctx.fill();
      });
      // back pattern
      ctx.strokeStyle = 'rgba(201,168,76,0.12)'; ctx.lineWidth = .5;
      for (let bx = -CW/2+8; bx < CW/2; bx += 16) {
        ctx.beginPath(); ctx.moveTo(bx,-CH/2); ctx.lineTo(bx,CH/2); ctx.stroke();
      }
      for (let by = -CH/2+8; by < CH/2; by += 16) {
        ctx.beginPath(); ctx.moveTo(-CW/2,by); ctx.lineTo(CW/2,by); ctx.stroke();
      }
      // center glyph
      ctx.font = `${CW*.45}px serif`; ctx.fillStyle = 'rgba(201,168,76,0.25)';
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('꩜',0,0);
      // border
      rrect(-CW/2,-CH/2,CW,CH,10);
      ctx.strokeStyle='rgba(201,168,76,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
    }
    ctx.restore();
  }

  // ── HUD ───────────────────────────────────────
  function drawHUD(pgIdx, totalPg) {
    const p = getProfiles()[state.wallet] || {};
    // top bar
    const barGrad = ctx.createLinearGradient(0,0,W,0);
    barGrad.addColorStop(0, 'rgba(10,11,8,0.95)');
    barGrad.addColorStop(1, 'rgba(10,11,8,0.7)');
    ctx.fillStyle = barGrad; ctx.fillRect(0,0,W,64);
    ctx.strokeStyle='rgba(201,168,76,0.2)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,64); ctx.lineTo(W,64); ctx.stroke();

    // logo mark
    ctx.font='bold 22px serif'; ctx.fillStyle='#c9a84c';
    ctx.textAlign='left'; ctx.textBaseline='middle'; ctx.fillText('꩜',24,32);
    ctx.font='bold 13px sans-serif'; ctx.letterSpacing='0.1em';
    ctx.fillText('MUDWATER BINDER',52,28);
    ctx.font='10px monospace'; ctx.fillStyle='rgba(201,168,76,0.5)';
    ctx.fillText(p.name || short(state.wallet), 52, 46);

    // right side
    ctx.textAlign='right';
    ctx.font=`bold 13px sans-serif`; ctx.fillStyle=col.color;
    ctx.fillText(`${col.label.toUpperCase()}`, W-24, 28);
    ctx.font='10px monospace'; ctx.fillStyle='rgba(201,168,76,0.4)';
    ctx.fillText(`${pgIdx+1} / ${totalPg}`, W-24, 46);

    // bottom bar
    ctx.fillStyle='rgba(10,11,8,0.9)'; ctx.fillRect(0,H-48,W,48);
    ctx.strokeStyle='rgba(201,168,76,0.15)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,H-48); ctx.lineTo(W,H-48); ctx.stroke();
    ctx.font='10px monospace'; ctx.fillStyle='rgba(201,168,76,0.3)';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('mudwater-binder.pages.dev', W/2, H-24);
  }

  // ── layout ────────────────────────────────────
  const COLS = 4, ROWS = 3;
  const PER_PG = COLS * ROWS;
  const GAP    = 20;
  const totalPg = Math.ceil(items.length / PER_PG);
  const gridW  = COLS * (CW + GAP) - GAP;
  const gridH  = ROWS * (CH + GAP) - GAP;
  const startX = (W - gridW) / 2 + CW/2;
  const startY = 64 + 20 + CH/2;

  // ── timing (at 30fps) ─────────────────────────
  const FPS       = 30;
  const INTRO_DUR = FPS * 1.5;  // 1.5s title card
  const FLIP_DUR  = FPS * 1.8;  // 1.8s per card flip wave
  const HOLD_DUR  = FPS * 1.2;  // 1.2s hold on completed page
  const TRANS_DUR = FPS * .5;   // .5s page transition
  const OUTRO_DUR = FPS * 1.5;  // 1.5s outro
  const PAGE_DUR  = FLIP_DUR + HOLD_DUR + TRANS_DUR;
  const TOTAL     = INTRO_DUR + totalPg * PAGE_DUR + OUTRO_DUR;

  // ── MediaRecorder setup ───────────────────────
  let stream, recorder, chunks = [];
  let canRecord = false;
  try {
    stream    = canvas.captureStream(FPS);
    const mt  = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
                  .find(m => MediaRecorder.isTypeSupported(m)) || '';
    recorder  = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 8_000_000 });
    recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = `mudwater-${tab}-${short(state.wallet)}.webm`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
    };
    recorder.start(100); // collect data every 100ms
    canRecord = true;
  } catch(e) {
    console.warn('MediaRecorder unavailable:', e);
  }

  // ── render loop ───────────────────────────────
  const cardFlipState = {}; // mintAddress → { phase, spawned }

  for (let frame = 0; frame < TOTAL; frame++) {
    if (cancelled) { if (recorder && canRecord) recorder.stop(); return; }

    const pct = 30 + (frame / TOTAL) * 60;
    setProgress(pct, `Rendering… ${Math.round(frame/FPS)}s`);

    const t = frame;
    drawBg(t);

    if (t < INTRO_DUR) {
      // ── INTRO TITLE CARD ──
      const p  = t / INTRO_DUR;
      const ep = p < .5 ? 2*p*p : -1+(4-2*p)*p; // ease in-out
      ctx.save();
      ctx.globalAlpha = Math.min(p * 3, 1) * (p > .8 ? (1-p)*5 : 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      // glow rings
      for (let r = 3; r >= 1; r--) {
        ctx.globalAlpha = (.04 * (4-r)) * Math.min(p*3,1);
        ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = r * 20;
        ctx.beginPath(); ctx.arc(W/2, H/2, 80 + ep*180, 0, Math.PI*2); ctx.stroke();
      }
      ctx.globalAlpha = Math.min(p*3,1);

      // main glyph
      ctx.font = `${120 + ep*40}px serif`;
      ctx.fillStyle = '#c9a84c';
      ctx.fillText('꩜', W/2, H/2 - 60);

      ctx.font = 'bold 48px sans-serif';
      ctx.fillStyle = '#e8e4d8';
      ctx.letterSpacing = '0.2em';
      ctx.fillText('MUDWATER', W/2, H/2 + 60);

      ctx.font = '20px sans-serif';
      ctx.fillStyle = col.color;
      ctx.letterSpacing = '0.4em';
      ctx.fillText(col.label.toUpperCase() + ' BINDER', W/2, H/2 + 100);

      const prof = getProfiles()[state.wallet] || {};
      ctx.font = '14px monospace';
      ctx.fillStyle = 'rgba(201,168,76,0.5)';
      ctx.letterSpacing = '0';
      ctx.fillText(prof.name || short(state.wallet), W/2, H/2 + 136);
      ctx.restore();

    } else {
      // ── PAGES ──
      const ft = t - INTRO_DUR;
      const pg = Math.min(Math.floor(ft / PAGE_DUR), totalPg - 1);
      const fip = ft - pg * PAGE_DUR;
      const pageItems = items.slice(pg * PER_PG, (pg+1) * PER_PG);

      // transition fade in
      const transAlpha = fip < TRANS_DUR ? (fip / TRANS_DUR) : 1;
      const isOutro    = t >= INTRO_DUR + totalPg * PAGE_DUR;

      if (isOutro) {
        // ── OUTRO ──
        const op = (t - INTRO_DUR - totalPg * PAGE_DUR) / OUTRO_DUR;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - op * 1.5);
        // just show all cards small
        const sc = 0.4;
        const oCols = Math.min(items.length, 8);
        const oW = oCols * (CW * sc + 8) - 8;
        const oX = (W - oW) / 2 + (CW * sc) / 2;
        items.slice(0, oCols).forEach((item, i) => {
          drawCard(item, oX + i*(CW*sc+8), H/2 - 20, 1, sc);
        });
        ctx.font = 'bold 32px sans-serif'; ctx.fillStyle = '#c9a84c';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${items.length} ${col.label} in the Swamp`, W/2, H/2 + CH*sc/2 + 32);
        ctx.font = '14px monospace'; ctx.fillStyle = 'rgba(201,168,76,0.4)';
        ctx.fillText('mudwater-binder.pages.dev', W/2, H/2 + CH*sc/2 + 64);
        ctx.restore();

      } else {
        ctx.globalAlpha = transAlpha;

        // draw each card
        pageItems.forEach((item, i) => {
          const col2 = i % COLS;
          const row  = Math.floor(i / COLS);
          const cx   = startX + col2 * (CW + GAP);
          const cy   = startY + row  * (CH + GAP);

          // staggered flip start
          const flipStart  = TRANS_DUR + i * (FLIP_DUR * .08);
          const flipWindow = FLIP_DUR * .7;
          const cardFt     = Math.max(0, fip - flipStart);
          const phase      = fip < (FLIP_DUR + TRANS_DUR)
            ? Math.min(cardFt / flipWindow, 1)
            : 1;

          // spawn particles at the moment card flips to face
          const key = `${pg}-${i}`;
          if (phase >= .5 && !cardFlipState[key]) {
            cardFlipState[key] = true;
            const rar = tab === 'cards' ? getRarity(item) : 'standard';
            const pc  = rar === 'foil' ? '#c084fc'
                      : rar === 'cracked-ice' ? '#7dd3fc'
                      : rar === 'serialized' ? '#f59e0b'
                      : '#c9a84c';
            spawnParticles(cx, cy, pc);
          }

          // hover bounce on face-up cards
          const bounce = phase === 1 ? Math.sin((fip - flipStart) * .08) * 3 : 0;
          drawCard(item, cx, cy - bounce, phase);
        });

        updateParticles();
        ctx.globalAlpha = 1;
        drawHUD(pg, totalPg);
      }
    }

    // yield to browser every frame
    await new Promise(r => setTimeout(r, 0));
  }

  // ── finish ────────────────────────────────────
  if (canRecord) {
    recorder.requestData();
    setTimeout(() => {
      recorder.stop();
      overlay.remove();
      toast('🎴 Binder downloaded!', 'success');
    }, 300);
  } else {
    // Fallback: download as PNG sequence zip — or just the last frame
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mudwater-binder-${tab}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    }, 'image/png');
    overlay.remove();
    toast('Video not supported — downloaded as image instead', 'success');
  }
}

// ═══════════════════════════════════════════════
//   COLLECTORS PAGE
// ═══════════════════════════════════════════════
$('btnSearchWallet').addEventListener('click', doSearch);
$('searchWallet').addEventListener('keydown', e => { if (e.key==='Enter') doSearch(); });

async function doSearch() {
  const q = $('searchWallet').value.trim();
  if (!q) return;
  const profiles = getProfiles();
  let wallet = q;
  for (const [addr, p] of Object.entries(profiles)) {
    if ((p.name||'').toLowerCase() === q.toLowerCase()) { wallet=addr; break; }
  }
  goToBinder(wallet);
}

function getKnown() {
  try { return JSON.parse(localStorage.getItem(STORE_COL)||'{}'); } catch { return {}; }
}
function cacheCollector(wallet, profile, counts) {
  const c = getKnown();
  c[wallet] = { counts, name: profile.name||'' };
  localStorage.setItem(STORE_COL, JSON.stringify(c));
}

function renderCollectors() {
  const known    = getKnown();
  const profiles = getProfiles();
  const list     = $('collectorsList');
  list.innerHTML = '';
  if (!Object.keys(known).length) {
    list.innerHTML='<p style="color:var(--text3);text-align:center;padding:40px 0">No collectors indexed yet. Connect your wallet to be first.</p>';
    return;
  }
  Object.entries(known).forEach(([wallet, info]) => {
    const p   = profiles[wallet] || {};
    const div = document.createElement('div');
    div.className = 'collector-card';
    const c = info.counts || {};
    div.innerHTML = `
      <div class="collector-card-avatar${p.pfp ? ' has-pfp' : ''}" style="${p.pfp ? `background-image:url(${p.pfp});background-size:cover;background-position:center` : ''}">
        ${p.pfp ? '' : getEmoji(wallet)}
      </div>
      <div>
        <div class="collector-card-name">${esc(p.name||short(wallet))}</div>
        <div class="collector-card-wallet">${short(wallet)}</div>
        <div class="collector-card-counts">
          ${c.cards ? `<span class="count-pill">🎴 ${c.cards}</span>` : ''}
          ${c.packs ? `<span class="count-pill">🃏 ${c.packs}</span>` : ''}
          ${c.boxes ? `<span class="count-pill">📦 ${c.boxes}</span>` : ''}
        </div>
      </div>
    `;
    div.addEventListener('click', () => goToBinder(wallet));
    list.appendChild(div);
  });
}

// ═══════════════════════════════════════════════
//   DEEP LINK ?wallet=
// ═══════════════════════════════════════════════
(function deepLink() {
  const w = new URLSearchParams(location.search).get('wallet');
  if (w) goToBinder(w);
})();

// ═══════════════════════════════════════════════
//   HELPERS
// ═══════════════════════════════════════════════
function short(addr='') { return addr ? `${addr.slice(0,4)}…${addr.slice(-4)}` : ''; }
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getRarity(card) {
  const name  = (card.name||'').toLowerCase();
  const attrs = card.attributes||card.traits||[];
  const finishAttr = attrs.find(a => (a.trait_type||'').toLowerCase()==='finish');
  const rarityAttr = attrs.find(a => (a.trait_type||'').toLowerCase()==='rarity');
  const finish = (finishAttr?.value||'').toLowerCase();
  const rv     = (rarityAttr?.value||'').toLowerCase();
  if (finish.includes('cracked') || name.includes('cracked')) return 'cracked-ice';
  if (finish.includes('foil')    || name.includes('foil'))    return 'foil';
  if (finish.includes('serial')  || name.includes('#'))       return 'serialized';
  if (rv.includes('rare') || rv.includes('epic') || rv.includes('legendary')) return 'serialized';
  return 'standard';
}
function rarityLabel(r) {
  return { foil:'Foil', serialized:'Serialized', 'cracked-ice':'Cracked Ice', standard:'Standard' }[r]||r;
}
function rarityColor(r) {
  return { foil:'#c084fc', serialized:'#f59e0b', 'cracked-ice':'#7dd3fc', standard:'rgba(201,168,76,.3)', packs:'#7dd3fc', boxes:'#c084fc' }[r]||'#c9a84c';
}
function serialText(item) {
  const attrs = item.attributes||item.traits||[];
  const s = attrs.find(a=>(a.trait_type||'').toLowerCase().includes('serial')||(a.trait_type||'').toLowerCase().includes('number'));
  if (s) return `#${s.value}`;
  const m = (item.name||'').match(/#(\d+)/);
  return m ? `#${m[1]}` : null;
}
const EMOJIS = ['🐊','🦎','🐸','🌿','🌊','꩜','🎴','🎯','🃏','♠','♣','♦','🧿','🌑','🔱'];
function getEmoji(addr='') {
  let h=0; for(const c of addr) h=(h*31+c.charCodeAt(0))|0;
  return EMOJIS[Math.abs(h)%EMOJIS.length];
}
let _tt;
function toast(msg, type='') {
  const el=$('toast'); el.textContent=msg; el.className=`toast ${type}`;
  el.classList.remove('hidden'); clearTimeout(_tt);
  _tt=setTimeout(()=>el.classList.add('hidden'),3500);
}
