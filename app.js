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
const ME_API    = 'https://api-mainnet.magiceden.dev/v2';
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
//   DOWNLOAD — animated binder flip
// ═══════════════════════════════════════════════
$('btnDownload').addEventListener('click', downloadBinder);

async function downloadBinder() {
  const tab   = state.activeTab;
  const items = (state.filtered.length ? state.filtered : state.data[tab]).slice(0, 60);
  if (!items.length) { toast('No items to download', 'error'); return; }
  if (!window.MediaRecorder) { toast('MediaRecorder not supported in this browser', 'error'); return; }

  toast('Rendering binder… grab a drink 🍵');

  const W = 960, H = 660;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // preload images
  const imgMap = {};
  for (const item of items) {
    if (!item.image) continue;
    await new Promise(res => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => { imgMap[item.image] = img; res(); };
      img.onerror = () => res();
      img.src = item.image;
    });
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9' : 'video/webm';
  const stream   = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks   = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `mudwater-binder-${tab}-${short(state.wallet)}.webm`;
    a.click();
    toast('Binder downloaded! 🎴', 'success');
  };
  recorder.start();

  const col    = COLLECTIONS[tab];
  const FPS    = 30;
  const COLS   = 5, ROWS = 2;
  const CW     = tab === 'cards' ? 148 : 192;
  const CH     = tab === 'cards' ? 207 : 128;
  const GAP    = 14;
  const PER_PG = COLS * ROWS;
  const totalPg= Math.ceil(items.length / PER_PG);
  const INTRO  = FPS;
  const FLIP   = FPS * 2;
  const HOLD   = Math.round(FPS * .6);
  const TOTAL  = INTRO + totalPg * (FLIP + HOLD) + FPS;

  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  function drawBg() {
    ctx.fillStyle = '#0a0b08'; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(201,168,76,0.04)'; ctx.lineWidth=1;
    for(let x=0;x<W;x+=44){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=0;y<H;y+=44){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  }

  function drawHUD(pgIdx) {
    const p = getProfiles()[state.wallet] || {};
    ctx.font='bold 13px sans-serif'; ctx.fillStyle='#c9a84c';
    ctx.textAlign='left'; ctx.fillText('MUDWATER BINDER',24,30);
    ctx.fillStyle='rgba(201,168,76,0.5)'; ctx.font='11px monospace';
    ctx.fillText(p.name||short(state.wallet),24,48);
    ctx.textAlign='right'; ctx.fillStyle=col.color;
    ctx.font='bold 11px sans-serif';
    ctx.fillText(`${col.icon} ${col.label.toUpperCase()}`,W-24,30);
    ctx.fillStyle='rgba(201,168,76,0.4)'; ctx.font='10px monospace';
    ctx.fillText(`Page ${pgIdx+1}/${totalPg}  ·  ${items.length} items`,W-24,48);
    ctx.textAlign='left';
  }

  function drawItem(item, cx, cy, flipPhase) {
    const sx = Math.abs(Math.cos(flipPhase * Math.PI));
    ctx.save();
    ctx.translate(cx+CW/2, cy+CH/2);
    ctx.scale(sx, 1);
    if (flipPhase < .5) {
      rrect(-CW/2,-CH/2,CW,CH,6);
      const img = item.image && imgMap[item.image];
      if (img) { ctx.save(); ctx.clip(); ctx.drawImage(img,-CW/2,-CH/2,CW,CH); ctx.restore(); }
      else { ctx.fillStyle='#1c2014'; ctx.fill(); ctx.font=`${CW*.3}px serif`; ctx.fillStyle=col.color; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(col.icon,0,0); }
      rrect(-CW/2,-CH/2,CW,CH,6); ctx.strokeStyle=col.color; ctx.lineWidth=1.5; ctx.stroke();
      if (tab==='cards') {
        const rar=getRarity(item);
        if (rar==='foil'||rar==='cracked-ice') {
          const gr=ctx.createLinearGradient(-CW/2,-CH/2,CW/2,CH/2);
          gr.addColorStop(0,'rgba(192,132,252,0.18)'); gr.addColorStop(.5,'rgba(96,165,250,0.18)'); gr.addColorStop(1,'rgba(52,211,153,0.18)');
          rrect(-CW/2,-CH/2,CW,CH,6); ctx.fillStyle=gr; ctx.fill();
        }
      }
    } else {
      rrect(-CW/2,-CH/2,CW,CH,6); ctx.fillStyle='#101309'; ctx.fill();
      ctx.strokeStyle='#c9a84c'; ctx.lineWidth=1; ctx.stroke();
      ctx.font=`${CW*.28}px serif`; ctx.fillStyle='rgba(201,168,76,0.3)';
      ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('꩜',0,0);
    }
    ctx.restore();
  }

  const startX = (W - (COLS*(CW+GAP)-GAP)) / 2;
  const startY = 68;

  for (let frame = 0; frame < TOTAL; frame++) {
    drawBg();
    let f = frame;
    if (f < INTRO) {
      ctx.font=`bold ${36*(f/INTRO)}px serif`; ctx.fillStyle=`rgba(201,168,76,${f/INTRO})`;
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(`Your Mudwater ${col.label} Binder`,W/2,H/2);
    } else {
      f -= INTRO;
      const pg  = Math.min(Math.floor(f/(FLIP+HOLD)), totalPg-1);
      const fip = f - pg*(FLIP+HOLD);
      const pageItems = items.slice(pg*PER_PG, (pg+1)*PER_PG);
      drawHUD(pg);
      pageItems.forEach((item,i) => {
        const col2=i%COLS, row=Math.floor(i/COLS);
        const cx=startX+col2*(CW+GAP), cy=startY+row*(CH+GAP);
        const delay=i*(FLIP*.07);
        const cf=Math.max(0,fip-delay);
        const phase=fip<FLIP ? Math.min(cf/(FLIP*.6),1) : 1;
        drawItem(item,cx,cy,1-phase);
      });
    }
    await new Promise(r => setTimeout(r,0));
  }
  recorder.stop();
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
