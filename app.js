/* =========================================================
   Outfit Vault — app.js (stable build)
   FIX principale: bulkBar visibile solo se (selectMode && selected>0)
   + modali chiudono sempre la selezione (no overlap)
   + IndexedDB + create flow + detail + filters + export/import
   ========================================================= */

/* -----------------------------
   SETTINGS + THEME
----------------------------- */
const SETTINGS_KEY = "outfit_vault_settings_v2";
const settingsDefault = { theme: "system" };

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...settingsDefault, ...JSON.parse(raw) } : { ...settingsDefault };
  } catch {
    return { ...settingsDefault };
  }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
function setThemeColor(color) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", color);
}
function syncThemeColorWithSystem() {
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setThemeColor(prefersDark ? "#0b1020" : "#f7f3ff");
}
function setTheme(theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
    syncThemeColorWithSystem();
    return;
  }
  root.setAttribute("data-theme", theme);
  setThemeColor(theme === "dark" ? "#0b1020" : "#f7f3ff");
}

/* -----------------------------
   IndexedDB
----------------------------- */
const DB_NAME = "OutfitVaultDB";
const DB_VERSION = 2;
const STORE = "outfits";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("rating", "rating", { unique: false });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("favorite", "favorite", { unique: false });
        store.createIndex("wearCount", "wearCount", { unique: false });
        store.createIndex("lastWornAt", "lastWornAt", { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function withTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function dbAdd(outfit) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.add(outfit));
}
async function dbPut(outfit) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.put(outfit));
}
async function dbDel(id) {
  const db = await openDB();
  return withTx(db, "readwrite", (store) => store.delete(id));
}
async function dbAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* -----------------------------
   Helpers
----------------------------- */
function uid() {
  return `o_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function safeName(name) {
  const s = (name || "").trim();
  return s ? s : "Outfit senza nome";
}
function clampRating(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.min(5, Math.max(0, Math.round(x)));
}
function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}
function formatDateOrDash(ts) {
  return ts ? formatDate(ts) : "—";
}
function parseTags(raw) {
  const s = (raw || "")
    .split(",")
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(s)).slice(0, 30);
}
function tagsToText(tags) {
  return (tags || []).join(", ");
}
function debounce(fn, wait = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function dataURLToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

/* Safe JPEG */
async function fileToSafeJpegBlob(file, maxSide = 1600, quality = 0.9) {
  let bitmap = null;
  if ("createImageBitmap" in window) {
    try { bitmap = await createImageBitmap(file); } catch { bitmap = null; }
  }

  if (!bitmap) {
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  const w = bitmap.width, h = bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, cw, ch);

  const blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return blob || file;
}

async function cropCenterSquareToJpeg(blobOrFile, maxSide = 1200, quality = 0.9) {
  let bitmap = null;
  if ("createImageBitmap" in window) {
    try { bitmap = await createImageBitmap(blobOrFile); } catch { bitmap = null; }
  }
  if (!bitmap) return fileToSafeJpegBlob(blobOrFile, maxSide, quality);

  const w = bitmap.width, h = bitmap.height;
  const side = Math.min(w, h);
  const sx = Math.floor((w - side) / 2);
  const sy = Math.floor((h - side) / 2);
  const outSide = Math.min(maxSide, side);

  const canvas = document.createElement("canvas");
  canvas.width = outSide; canvas.height = outSide;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, outSide, outSide);

  const outBlob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });

  return outBlob || blobOrFile;
}

/* -----------------------------
   Elements
----------------------------- */
const el = {
  grid: document.getElementById("grid"),
  emptyState: document.getElementById("emptyState"),

  addBtn: document.getElementById("addBtn"),
  emptyAddBtn: document.getElementById("emptyAddBtn"),
  fileInput: document.getElementById("fileInput"),

  searchInput: document.getElementById("searchInput"),
  sortSelect: document.getElementById("sortSelect"),
  savedCount: document.getElementById("savedCount"),

  // filters
  filterAll: document.getElementById("filterAll"),
  filterFav: document.getElementById("filterFav"),
  filter4plus: document.getElementById("filter4plus"),
  filterStale: document.getElementById("filterStale"),
  filterClearTag: document.getElementById("filterClearTag"),
  tagChips: document.getElementById("tagChips"),

  // selection
  selectModeBtn: document.getElementById("selectModeBtn"),
  bulkBar: document.getElementById("bulkBar"),
  bulkCount: document.getElementById("bulkCount"),
  bulkFav: document.getElementById("bulkFav"),
  bulkExport: document.getElementById("bulkExport"),
  bulkDelete: document.getElementById("bulkDelete"),
  bulkDone: document.getElementById("bulkDone"),

  // toast
  toast: document.getElementById("toast"),
  toastMsg: document.getElementById("toastMsg"),
  toastAction: document.getElementById("toastAction"),

  // create modal
  createBackdrop: document.getElementById("createBackdrop"),
  createModal: document.getElementById("createModal"),
  closeCreate: document.getElementById("closeCreate"),
  createPreview: document.getElementById("createPreview"),
  createName: document.getElementById("createName"),
  createStars: document.getElementById("createStars"),
  createFav: document.getElementById("createFav"),
  createTags: document.getElementById("createTags"),
  createTagPreview: document.getElementById("createTagPreview"),
  createNotes: document.getElementById("createNotes"),
  createCropSquare: document.getElementById("createCropSquare"),
  createCancel: document.getElementById("createCancel"),
  createSave: document.getElementById("createSave"),

  // detail modal
  detailBackdrop: document.getElementById("detailBackdrop"),
  detailModal: document.getElementById("detailModal"),
  closeDetail: document.getElementById("closeDetail"),
  detailTitle: document.getElementById("detailTitle"),
  detailMeta: document.getElementById("detailMeta"),
  detailImg: document.getElementById("detailImg"),
  detailName: document.getElementById("detailName"),
  detailStars: document.getElementById("detailStars"),
  detailFav: document.getElementById("detailFav"),
  detailTags: document.getElementById("detailTags"),
  detailTagPreview: document.getElementById("detailTagPreview"),
  detailNotes: document.getElementById("detailNotes"),
  wearCount: document.getElementById("wearCount"),
  lastWorn: document.getElementById("lastWorn"),
  wearTodayBtn: document.getElementById("wearTodayBtn"),
  shareBtn: document.getElementById("shareBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  saveDetailBtn: document.getElementById("saveDetailBtn"),

  // settings modal
  openSettings: document.getElementById("openSettings"),
  settingsBackdrop: document.getElementById("settingsBackdrop"),
  settingsModal: document.getElementById("settingsModal"),
  closeSettings: document.getElementById("closeSettings"),
  themeSelect: document.getElementById("themeSelect"),
  saveSettings: document.getElementById("saveSettings"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),

  // install
  installBtn: document.getElementById("installBtn"),
  installBtnText: document.getElementById("installBtnText")
};

/* -----------------------------
   State
----------------------------- */
const state = {
  outfits: [],
  filtered: [],
  search: "",
  sort: "date_desc",
  settings: loadSettings(),

  filter: { fav:false, minRating:0, staleDays:0, tag:"" },

  selectedId: null,
  selectedURL: null,

  // ✅ important: start false
  selectMode: false,
  selectedSet: new Set(),

  lastDeleted: null
};

const urlCache = new Map(); // id -> objectURL
function getThumbURL(outfit) {
  if (!urlCache.has(outfit.id)) {
    urlCache.set(outfit.id, URL.createObjectURL(outfit.imageBlob));
  }
  return urlCache.get(outfit.id);
}
function revokeThumbURL(id) {
  const u = urlCache.get(id);
  if (!u) return;
  try { URL.revokeObjectURL(u); } catch {}
  urlCache.delete(id);
}
function keepOnlyThumbs(validIds) {
  for (const [id, u] of urlCache.entries()) {
    if (validIds.has(id)) continue;
    try { URL.revokeObjectURL(u); } catch {}
    urlCache.delete(id);
  }
}

const createState = { file:null, previewURL:null };

/* -----------------------------
   UI helpers
----------------------------- */
function showToast(msg, actionText="", onAction=null, ttl=2500) {
  if (!el.toast) return;
  el.toastMsg.textContent = msg;

  el.toastAction.hidden = true;
  el.toastAction.onclick = null;

  if (actionText && typeof onAction === "function") {
    el.toastAction.hidden = false;
    el.toastAction.textContent = actionText;
    el.toastAction.onclick = () => onAction();
  }

  el.toast.hidden = false;
  setTimeout(() => { el.toast.hidden = true; }, ttl);
}

/* ✅ MODAL: when opens -> selection OFF */
function suspendSelectionUI() {
  state.selectMode = false;
  state.selectedSet.clear();
  syncBulkUI(); // this will hide it
}

function openModal(backdrop, modal) {
  suspendSelectionUI();
  backdrop.hidden = false;
  modal.hidden = false;
}
function closeModal(backdrop, modal) {
  backdrop.hidden = true;
  modal.hidden = true;
}

/* stars */
function renderStars(container, value, onChange) {
  container.innerHTML = "";
  const current = clampRating(value);
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "star-btn" + (i <= current ? " active" : "");
    b.textContent = i <= current ? "⭐" : "☆";
    b.addEventListener("click", () => onChange(i));
    container.appendChild(b);
  }
}

/* tags chips */
function renderTagChips(container, tags, activeTag, onClick) {
  container.innerHTML = "";
  for (const t of tags) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tagchip" + (t === activeTag ? " active" : "");
    b.textContent = t;
    b.addEventListener("click", () => onClick(t));
    container.appendChild(b);
  }
}
function collectAllTags(outfits) {
  const set = new Set();
  for (const o of outfits) for (const t of (o.tags || [])) set.add(t);
  return Array.from(set).sort((a,b) => a.localeCompare(b)).slice(0, 40);
}

/* -----------------------------
   ✅ BULK BAR FIX (core)
   show only if (selectMode && selected > 0)
----------------------------- */
function syncBulkUI() {
  const count = state.selectedSet.size;

  if (el.bulkCount) el.bulkCount.textContent = String(count);

  // ✅ this is the “no more ghost bar” rule:
  const shouldShow = state.selectMode && count > 0;

  if (el.bulkBar) el.bulkBar.hidden = !shouldShow;

  if (el.selectModeBtn) {
    el.selectModeBtn.textContent = state.selectMode ? "✓ Selezione attiva" : "✓ Seleziona";
    el.selectModeBtn.classList.toggle("chip-active", state.selectMode);
  }

  const disabled = count === 0;
  if (el.bulkFav) el.bulkFav.disabled = disabled;
  if (el.bulkExport) el.bulkExport.disabled = disabled;
  if (el.bulkDelete) el.bulkDelete.disabled = disabled;
}

function enableSelectMode(on) {
  state.selectMode = !!on;
  if (!state.selectMode) state.selectedSet.clear();
  syncBulkUI();
  renderGrid();
}

/* -----------------------------
   Filters + sorting + render
----------------------------- */
function applyFiltersAndSort() {
  let arr = [...state.outfits];
  const q = state.search.trim().toLowerCase();

  if (state.filter.fav) arr = arr.filter(o => !!o.favorite);
  if (state.filter.minRating > 0) arr = arr.filter(o => (o.rating||0) >= state.filter.minRating);
  if (state.filter.staleDays > 0) {
    const limit = Date.now() - state.filter.staleDays * 86400000;
    arr = arr.filter(o => (o.lastWornAt||0) === 0 || (o.lastWornAt||0) < limit);
  }
  if (state.filter.tag) arr = arr.filter(o => (o.tags||[]).includes(state.filter.tag));

  if (q) {
    arr = arr.filter(o =>
      (o.name||"").toLowerCase().includes(q) ||
      (o.notes||"").toLowerCase().includes(q)
    );
  }

  const s = state.sort;
  if (s === "fav_only") arr = arr.filter(o => !!o.favorite);

  arr.sort((a,b) => {
    const af = a.favorite ? 1 : 0;
    const bf = b.favorite ? 1 : 0;

    if (s === "fav_first") {
      if (bf !== af) return bf - af;
      return (b.createdAt||0) - (a.createdAt||0);
    }
    if (s === "date_desc") return (b.createdAt||0) - (a.createdAt||0);
    if (s === "date_asc") return (a.createdAt||0) - (b.createdAt||0);
    if (s === "rating_desc") return (b.rating||0) - (a.rating||0);
    if (s === "rating_asc") return (a.rating||0) - (b.rating||0);
    if (s === "name_asc") return (a.name||"").localeCompare(b.name||"");
    if (s === "name_desc") return (b.name||"").localeCompare(a.name||"");
    if (s === "wear_desc") return (b.wearCount||0) - (a.wearCount||0);
    if (s === "wear_asc") return (a.wearCount||0) - (b.wearCount||0);
    if (s === "lastworn_asc") return (a.lastWornAt||0) - (b.lastWornAt||0);
    if (s === "lastworn_desc") return (b.lastWornAt||0) - (a.lastWornAt||0);
    return 0;
  });

  state.filtered = arr;
}

function setFilterChipActive() {
  const allOn = !state.filter.fav && state.filter.minRating === 0 && state.filter.staleDays === 0 && !state.filter.tag;
  el.filterAll.classList.toggle("chip-active", allOn);
  el.filterFav.classList.toggle("chip-active", !!state.filter.fav);
  el.filter4plus.classList.toggle("chip-active", state.filter.minRating === 4);
  el.filterStale.classList.toggle("chip-active", state.filter.staleDays === 30);
  el.filterClearTag.hidden = !state.filter.tag;
}

function renderGrid() {
  applyFiltersAndSort();
  const items = state.filtered;

  el.grid.innerHTML = "";
  keepOnlyThumbs(new Set(items.map(o => o.id)));

  if (!items.length) {
    el.emptyState.hidden = false;
    return;
  }
  el.emptyState.hidden = true;

  for (const outfit of items) {
    const card = document.createElement("article");
    card.className = "card";
    card.tabIndex = 0;

    if (state.selectMode) card.classList.add("selectable");
    if (state.selectedSet.has(outfit.id)) card.classList.add("selected");

    const sel = document.createElement("div");
    sel.className = "selbox";
    sel.textContent = state.selectedSet.has(outfit.id) ? "✓" : "";

    const img = document.createElement("img");
    img.className = "thumb";
    img.alt = outfit.name || "Outfit";
    img.loading = "lazy";
    img.src = getThumbURL(outfit);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = safeName(outfit.name);

    const meta = document.createElement("div");
    meta.className = "card-meta";

    const date = document.createElement("span");
    date.textContent = formatDate(outfit.createdAt || Date.now());

    const badge = document.createElement("span");
    badge.className = "badge";
    const r = clampRating(outfit.rating);
    badge.textContent = (r ? `⭐ ${r}/5` : "⭐ —") + (outfit.favorite ? " ❤️" : "");

    meta.appendChild(date);
    meta.appendChild(badge);

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(sel);
    card.appendChild(img);
    card.appendChild(body);

    const toggleSelection = () => {
      if (state.selectedSet.has(outfit.id)) state.selectedSet.delete(outfit.id);
      else state.selectedSet.add(outfit.id);
      syncBulkUI();
      renderGrid();
    };

    card.addEventListener("click", () => {
      if (state.selectMode) toggleSelection();
      else openDetail(outfit.id);
    });

    // long press -> selection mode
    let pressTimer = null;
    card.addEventListener("pointerdown", () => {
      if (state.selectMode) return;
      pressTimer = setTimeout(() => {
        state.selectMode = true;
        state.selectedSet.add(outfit.id);
        syncBulkUI();
        renderGrid();
      }, 420);
    });
    card.addEventListener("pointerup", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });
    card.addEventListener("pointercancel", () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; });

    el.grid.appendChild(card);
  }
}

/* -----------------------------
   Create flow
----------------------------- */
function startCreateFromFile(file) {
  if (!file) return;

  if (createState.previewURL) {
    try { URL.revokeObjectURL(createState.previewURL); } catch {}
  }
  createState.file = file;
  createState.previewURL = URL.createObjectURL(file);

  el.createPreview.src = createState.previewURL;
  el.createName.value = file.name ? file.name.replace(/\.[^/.]+$/, "") : "";
  el.createFav.checked = false;
  el.createTags.value = "";
  el.createNotes.value = "";
  el.createCropSquare.checked = true;

  const setCreateRating = (n) => {
    renderStars(el.createStars, n, setCreateRating);
    el.createStars.dataset.value = String(n);
  };
  setCreateRating(0);

  el.createTagPreview.innerHTML = "";

  openModal(el.createBackdrop, el.createModal);
}

async function confirmCreateSave() {
  if (!createState.file) return;
  el.createSave.disabled = true;

  try {
    const name = safeName(el.createName.value);
    const rating = clampRating(el.createStars.dataset.value || 0);
    const favorite = !!el.createFav.checked;
    const tags = parseTags(el.createTags.value);
    const notes = (el.createNotes.value || "").trim();

    const safeBlob = await fileToSafeJpegBlob(createState.file, 1600, 0.9);
    const finalBlob = el.createCropSquare.checked
      ? await cropCenterSquareToJpeg(safeBlob, 1200, 0.9)
      : safeBlob;

    const outfit = {
      id: uid(),
      name,
      rating,
      favorite,
      createdAt: Date.now(),
      imageBlob: finalBlob,
      tags,
      notes,
      wearCount: 0,
      lastWornAt: 0
    };

    await dbAdd(outfit);

    closeModal(el.createBackdrop, el.createModal);
    createState.file = null;
    if (createState.previewURL) { try { URL.revokeObjectURL(createState.previewURL); } catch {} }
    createState.previewURL = null;
    el.fileInput.value = "";

    await refresh();
    showToast("Salvato ✅");
  } catch (e) {
    console.error(e);
    alert("Errore nel salvataggio. Prova una foto più piccola o libera spazio.");
  } finally {
    el.createSave.disabled = false;
  }
}

/* -----------------------------
   Detail
----------------------------- */
async function openDetail(id) {
  const outfit = await dbGet(id);
  if (!outfit) return;

  state.selectedId = id;

  el.detailTitle.textContent = safeName(outfit.name);
  el.detailMeta.textContent = `Creato: ${formatDate(outfit.createdAt || Date.now())}`;

  if (state.selectedURL) { try { URL.revokeObjectURL(state.selectedURL); } catch {} }
  state.selectedURL = URL.createObjectURL(outfit.imageBlob);
  el.detailImg.src = state.selectedURL;

  el.detailName.value = outfit.name || "";
  el.detailFav.checked = !!outfit.favorite;
  el.detailTags.value = tagsToText(outfit.tags || []);
  el.detailNotes.value = outfit.notes || "";

  const setDetailRating = (n) => {
    renderStars(el.detailStars, n, setDetailRating);
    el.detailStars.dataset.value = String(n);
  };
  setDetailRating(clampRating(outfit.rating || 0));

  el.wearCount.textContent = String(outfit.wearCount || 0);
  el.lastWorn.textContent = formatDateOrDash(outfit.lastWornAt || 0);

  openModal(el.detailBackdrop, el.detailModal);
}

async function saveDetail() {
  if (!state.selectedId) return;
  const outfit = await dbGet(state.selectedId);
  if (!outfit) return;

  const updated = {
    ...outfit,
    name: safeName(el.detailName.value),
    rating: clampRating(el.detailStars.dataset.value || 0),
    favorite: !!el.detailFav.checked,
    tags: parseTags(el.detailTags.value),
    notes: (el.detailNotes.value || "").trim()
  };

  await dbPut(updated);
  await refresh();
  showToast("Aggiornato ✅");
}

async function wearToday() {
  if (!state.selectedId) return;
  const outfit = await dbGet(state.selectedId);
  if (!outfit) return;

  const updated = {
    ...outfit,
    wearCount: (outfit.wearCount || 0) + 1,
    lastWornAt: Date.now()
  };

  await dbPut(updated);
  el.wearCount.textContent = String(updated.wearCount);
  el.lastWorn.textContent = formatDate(updated.lastWornAt);
  await refresh();
  showToast("Indossato 👟");
}

async function deleteDetail() {
  if (!state.selectedId) return;
  const outfit = await dbGet(state.selectedId);
  if (!outfit) return;

  state.lastDeleted = outfit;

  await dbDel(outfit.id);
  revokeThumbURL(outfit.id);

  closeModal(el.detailBackdrop, el.detailModal);
  await refresh();

  showToast("Eliminato", "Undo", async () => {
    if (!state.lastDeleted) return;
    await dbPut(state.lastDeleted);
    state.lastDeleted = null;
    await refresh();
    showToast("Ripristinato ✅");
  }, 5000);
}

async function shareDetail() {
  if (!state.selectedId) return;
  const outfit = await dbGet(state.selectedId);
  if (!outfit) return;

  const name = safeName(outfit.name);
  const file = new File([outfit.imageBlob], `${name}.jpg`, { type: outfit.imageBlob.type || "image/jpeg" });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ title: name, files: [file] }); return; } catch {}
  }
  alert("Condivisione non supportata su questo dispositivo/browser.");
}

/* -----------------------------
   Export/Import
----------------------------- */
async function exportOutfits(outfits, filename="outfit-vault-backup.json") {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    outfits: []
  };

  for (const o of outfits) {
    const imgData = await blobToDataURL(o.imageBlob);
    payload.outfits.push({
      id: o.id,
      name: o.name,
      rating: o.rating,
      favorite: o.favorite,
      createdAt: o.createdAt,
      tags: o.tags || [],
      notes: o.notes || "",
      wearCount: o.wearCount || 0,
      lastWornAt: o.lastWornAt || 0,
      imageDataUrl: imgData
    });
  }

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 1500);
  showToast("Export creato ⬇️");
}

async function importOutfitsFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.outfits)) throw new Error("Formato non valido");

  const existing = new Set(state.outfits.map(o => o.id));

  for (const o of data.outfits) {
    if (!o?.imageDataUrl) continue;
    const blob = await dataURLToBlob(o.imageDataUrl);
    const id = (o.id && !existing.has(o.id)) ? o.id : uid();
    existing.add(id);

    await dbPut({
      id,
      name: safeName(o.name),
      rating: clampRating(o.rating || 0),
      favorite: !!o.favorite,
      createdAt: Number(o.createdAt || Date.now()),
      imageBlob: blob,
      tags: Array.isArray(o.tags) ? o.tags : parseTags(o.tags || ""),
      notes: (o.notes || "").trim(),
      wearCount: Number(o.wearCount || 0),
      lastWornAt: Number(o.lastWornAt || 0)
    });
  }

  await refresh();
  showToast("Import completato ✅");
}

/* -----------------------------
   Bulk actions
----------------------------- */
async function bulkToggleFavorite() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;
  const selected = state.outfits.filter(o => ids.includes(o.id));
  const allFav = selected.length && selected.every(o => !!o.favorite);
  const target = !allFav;

  for (const o of selected) await dbPut({ ...o, favorite: target });

  enableSelectMode(false);
  await refresh();
  showToast(target ? "Preferiti ✅" : "Preferiti rimossi");
}

async function bulkDelete() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;

  const deleted = state.outfits.filter(o => ids.includes(o.id));
  for (const o of deleted) {
    await dbDel(o.id);
    revokeThumbURL(o.id);
  }

  enableSelectMode(false);
  await refresh();

  showToast(`Eliminati ${deleted.length}`, "Undo", async () => {
    for (const o of deleted) await dbPut(o);
    await refresh();
    showToast("Ripristinati ✅");
  }, 5000);
}

async function bulkExportSelected() {
  const ids = Array.from(state.selectedSet);
  if (!ids.length) return;
  const selected = state.outfits.filter(o => ids.includes(o.id));
  await exportOutfits(selected, "outfit-vault-selezionati.json");
  enableSelectMode(false);
}

/* -----------------------------
   Refresh
----------------------------- */
async function refresh() {
  state.outfits = await dbAll();
  el.savedCount.textContent = String(state.outfits.length);

  const tags = collectAllTags(state.outfits);
  renderTagChips(el.tagChips, tags, state.filter.tag, (t) => {
    state.filter.tag = t;
    setFilterChipActive();
    renderGrid();
  });

  setFilterChipActive();
  syncBulkUI();
  renderGrid();
}

/* -----------------------------
   PWA install + SW
----------------------------- */
let deferredInstallEvent = null;

function setupPWAInstall() {
  if (!el.installBtn) return;
  el.installBtn.hidden = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallEvent = e;
    el.installBtn.hidden = false;
  });

  el.installBtn.addEventListener("click", async () => {
    if (!deferredInstallEvent) return;
    deferredInstallEvent.prompt();
    try { await deferredInstallEvent.userChoice; } catch {}
    deferredInstallEvent = null;
    el.installBtn.hidden = true;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallEvent = null;
    el.installBtn.hidden = true;
  });
}

function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {});
  });
}

/* -----------------------------
   Init
----------------------------- */
(function init() {
  // theme
  setTheme(state.settings.theme);
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq) mq.addEventListener("change", () => { if (state.settings.theme === "system") syncThemeColorWithSystem(); });

  // ✅ HARD GUARANTEE: bulkBar hidden at boot
  state.selectMode = false;
  state.selectedSet.clear();
  if (el.bulkBar) el.bulkBar.hidden = true;

  refresh().catch(console.error);

  // add
  el.addBtn.addEventListener("click", () => { enableSelectMode(false); el.fileInput.click(); });
  if (el.emptyAddBtn) el.emptyAddBtn.addEventListener("click", () => { enableSelectMode(false); el.fileInput.click(); });

  el.fileInput.addEventListener("change", (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    startCreateFromFile(file);
  });

  // create modal
  el.closeCreate.addEventListener("click", () => closeModal(el.createBackdrop, el.createModal));
  el.createBackdrop.addEventListener("click", () => closeModal(el.createBackdrop, el.createModal));
  el.createCancel.addEventListener("click", () => closeModal(el.createBackdrop, el.createModal));
  el.createSave.addEventListener("click", confirmCreateSave);
  el.createTags.addEventListener("input", () => {
    const tags = parseTags(el.createTags.value);
    renderTagChips(el.createTagPreview, tags, "", () => {});
  });

  // search/sort
  el.searchInput.addEventListener("input", debounce(() => {
    state.search = el.searchInput.value || "";
    renderGrid();
  }, 120));

  el.sortSelect.addEventListener("change", () => {
    state.sort = el.sortSelect.value;
    renderGrid();
  });

  // quick filters
  el.filterAll.addEventListener("click", () => {
    state.filter = { fav:false, minRating:0, staleDays:0, tag:"" };
    setFilterChipActive();
    renderGrid();
  });
  el.filterFav.addEventListener("click", () => { state.filter.fav = !state.filter.fav; setFilterChipActive(); renderGrid(); });
  el.filter4plus.addEventListener("click", () => {
    state.filter.minRating = state.filter.minRating === 4 ? 0 : 4;
    setFilterChipActive(); renderGrid();
  });
  el.filterStale.addEventListener("click", () => {
    state.filter.staleDays = state.filter.staleDays === 30 ? 0 : 30;
    setFilterChipActive(); renderGrid();
  });
  el.filterClearTag.addEventListener("click", () => {
    state.filter.tag = "";
    setFilterChipActive(); renderGrid();
  });

  // selection toggle
  el.selectModeBtn.addEventListener("click", () => {
    // entra/esci selezione ma bulk compare solo se selezioni qualcosa
    state.selectMode = !state.selectMode;
    if (!state.selectMode) state.selectedSet.clear();
    syncBulkUI();
    renderGrid();
  });
  el.bulkDone.addEventListener("click", () => enableSelectMode(false));
  el.bulkFav.addEventListener("click", bulkToggleFavorite);
  el.bulkDelete.addEventListener("click", bulkDelete);
  el.bulkExport.addEventListener("click", bulkExportSelected);

  // detail modal
  el.closeDetail.addEventListener("click", () => closeModal(el.detailBackdrop, el.detailModal));
  el.detailBackdrop.addEventListener("click", () => closeModal(el.detailBackdrop, el.detailModal));
  el.saveDetailBtn.addEventListener("click", saveDetail);
  el.deleteBtn.addEventListener("click", deleteDetail);
  el.shareBtn.addEventListener("click", shareDetail);
  el.wearTodayBtn.addEventListener("click", wearToday);

  // settings
  el.openSettings.addEventListener("click", () => openModal(el.settingsBackdrop, el.settingsModal));
  el.closeSettings.addEventListener("click", () => closeModal(el.settingsBackdrop, el.settingsModal));
  el.settingsBackdrop.addEventListener("click", () => closeModal(el.settingsBackdrop, el.settingsModal));

  el.themeSelect.value = state.settings.theme;
  el.saveSettings.addEventListener("click", () => {
    state.settings.theme = el.themeSelect.value;
    saveSettings(state.settings);
    setTheme(state.settings.theme);
    closeModal(el.settingsBackdrop, el.settingsModal);
    showToast("Impostazioni salvate ✅");
  });

  el.exportBtn.addEventListener("click", async () => exportOutfits(await dbAll()));
  el.importBtn.addEventListener("click", () => el.importFile.click());
  el.importFile.addEventListener("change", async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    try { await importOutfitsFromFile(file); }
    catch { alert("Import fallito: file non valido."); }
    finally { el.importFile.value = ""; }
  });

  // ESC
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!el.createModal.hidden) closeModal(el.createBackdrop, el.createModal);
    else if (!el.detailModal.hidden) closeModal(el.detailBackdrop, el.detailModal);
    else if (!el.settingsModal.hidden) closeModal(el.settingsBackdrop, el.settingsModal);
    else if (state.selectMode) enableSelectMode(false);
  });

  setupServiceWorker();
  setupPWAInstall();
})();
