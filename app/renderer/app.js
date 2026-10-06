// Рендерер общается с движком только через window.api (см. app/main/preload.ts).

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const SVG_NS = 'http://www.w3.org/2000/svg';

// Под нативные кнопки окна (Windows) резервируется полоса сверху.
document.documentElement.classList.toggle('overlay', !!window.api.overlay);

// ---------- справочники ----------

const TYPE_LABELS = {
  knives: 'Ножи',
  gloves: 'Перчатки',
  rifles: 'Винтовки',
  smgs: 'ПП',
  pistols: 'Пистолеты',
  shotguns: 'Дробовики',
  machineGuns: 'Пулемёты',
  stickers: 'Наклейки',
  music: 'Музыка',
  other: 'Другое'
};

const REF_LABELS = {
  csfloat_predicted: 'CSFloat predicted',
  csfloat_base: 'CSFloat base',
  steam_scm: 'Steam'
};

const WEARS = {
  'Factory New': { abbr: 'FN', cls: 'w-fn' },
  'Minimal Wear': { abbr: 'MW', cls: 'w-mw' },
  'Field-Tested': { abbr: 'FT', cls: 'w-ft' },
  'Well-Worn': { abbr: 'WW', cls: 'w-ww' },
  'Battle-Scarred': { abbr: 'BS', cls: 'w-bs' }
};

// Значок в плитке, пока нет картинки предмета (или она не загрузилась).
const GLYPHS = {
  knives: 'g-knife',
  gloves: 'g-glove',
  rifles: 'g-gun',
  smgs: 'g-gun',
  pistols: 'g-gun',
  shotguns: 'g-gun',
  machineguns: 'g-gun',
  machineGuns: 'g-gun',
  stickers: 'g-sticker',
  music: 'g-music',
  other: 'g-box'
};

// CSFloat отдаёт icon_url хешем картинки Steam, а не готовой ссылкой.
const ICON_BASE = 'https://community.cloudflare.steamstatic.com/economy/image/';
const iconSrc = (raw) => (/^https?:/.test(raw) ? raw : ICON_BASE + raw);

const MAX_DEALS = 200;
/** Сколько последних находок показывает живая лента над карточками. */
const MAX_DROPS = 14;

// Цвет карточки — как редкость предмета в кейсе, только мерило здесь скидка:
// чем жирнее скидка, тем «реже» цвет. Легенда на странице это объясняет.
const TIERS = [
  { min: 30, key: 'gold', label: 'Джекпот' },
  { min: 20, key: 'red', label: 'Горячо' },
  { min: 15, key: 'pink', label: null },
  { min: 10, key: 'purple', label: null },
  { min: -Infinity, key: 'blue', label: null }
];
const tierOf = (deal) => TIERS.find((t) => deal.discountPercent >= t.min);

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- состояние ----------

let state = null;
let currentTab = 'alerts';
let lastStats = { scanned: 0, matched: 0 };

let dealsData = []; // новейшие первыми
let dealSort = 'new';
const boughtIds = new Set();
let unseen = 0;

let journalFilter = 'all';
let activePresetId = null;
let dirty = false;

// ---------- помощники ----------

/** Короткий конструктор DOM: только textContent, никакого innerHTML. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Иконка из спрайта в index.html: icon('i-check') или icon('g-gun', 'ico glyph'). */
function icon(id, cls = 'ico') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}

const num = (n) => Number(n || 0).toLocaleString('ru-RU');
const usd = (v) =>
  (v < 0 ? '−$' : '$') +
  Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = (v) => (v >= 0 ? '+' : '') + usd(v);
const problemsText = (res) => (res.problems || []).join('; ');

/** Цифры докручиваются до нового значения, как счётчик на автомате. */
function animateNumber(el, to, fmt) {
  const from = Number(el.dataset.value);
  el.dataset.value = String(to);
  cancelAnimationFrame(el._raf);
  if (reduceMotion || !Number.isFinite(from) || from === to) {
    el.textContent = fmt(to);
    return;
  }
  const start = performance.now();
  const duration = 650;
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
const fmtCount = (v) => num(Math.round(v));

function agoText(foundAt) {
  const s = Math.max(0, (Date.now() - Date.parse(foundAt)) / 1000);
  if (s < 45) return 'только что';
  if (s < 3600) return Math.round(s / 60) + ' мин назад';
  if (s < 86400) return Math.round(s / 3600) + ' ч назад';
  return new Date(foundAt).toLocaleDateString('ru-RU');
}

function fmtAge(seconds) {
  if (seconds < 60) return Math.round(seconds) + 'с';
  return Math.round(seconds / 60) + 'м';
}

// ---------- уведомления ----------

const TOAST_ICONS = { ok: 'i-check', error: 'i-info', warn: 'i-info', info: 'i-info' };

function notify(message, kind = 'info', ttl = 5200) {
  const box = $('toasts');
  const toast = h('div', { class: 'toast ' + kind, role: 'status' }, icon(TOAST_ICONS[kind]), h('span', { text: message }));
  const close = () => {
    if (!toast.isConnected || toast.classList.contains('out')) return;
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 240);
  };
  toast.addEventListener('click', close);
  box.append(toast);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(close, ttl);
}

// Фатальная ошибка движка не исчезает сама: опрос остановлен, пользователь должен это видеть.
function showFatal(message) {
  $('bannerText').textContent = message;
  $('banner').classList.add('fatal');
  $('banner').hidden = false;
}
$('bannerClose').addEventListener('click', () => { $('banner').hidden = true; });

// ---------- навигация ----------

function switchTab(name) {
  currentTab = name;
  $$('.nav-item').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  $('scroll').scrollTop = 0;
  if (name === 'orders') loadOrders();
  if (name === 'alerts') setBadge(0);
}

function switchPane(name) {
  $$('.subnav-item').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
}

function goSettings(pane) {
  switchTab('settings');
  switchPane(pane);
}

function setBadge(n) {
  unseen = n;
  const badge = $('alertsBadge');
  badge.hidden = n === 0;
  badge.textContent = n > 99 ? '99+' : String(n);
}

$$('.nav-item').forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
$$('.subnav-item').forEach((b) => b.addEventListener('click', () => switchPane(b.dataset.pane)));

// ---------- поля со слайдером ----------
// Число и ползунок правят одно значение. Число — источник правды: ползунок
// ограничен разумным диапазоном, а вручную можно ввести и больше.
const fields = new Map();

function initFields() {
  $$('.field[data-range]').forEach((wrap) => {
    const id = wrap.dataset.range;
    const unit = wrap.dataset.unit || '';

    const number = h('input', { type: 'number', id, min: wrap.dataset.min, step: wrap.dataset.step, inputmode: 'decimal' });
    const slider = h('input', {
      type: 'range',
      class: 'slider',
      'aria-label': wrap.dataset.label,
      min: wrap.dataset.min,
      max: wrap.dataset.max,
      step: wrap.dataset.step
    });
    const unitEl = unit ? h('span', { class: 'unit' + (unit === '$' ? ' pre' : ''), text: unit }) : null;

    wrap.append(
      h('div', { class: 'field-head' }, h('label', { for: id, text: wrap.dataset.label }), h('div', { class: 'num' }, number, unitEl)),
      slider
    );

    const paint = () => {
      const min = Number(slider.min);
      const max = Number(slider.max);
      const pct = Math.min(100, Math.max(0, ((Number(number.value) - min) / (max - min)) * 100));
      slider.style.setProperty('--fill', pct + '%');
    };

    number.addEventListener('input', () => {
      slider.value = number.value;
      paint();
    });
    slider.addEventListener('input', () => {
      number.value = slider.value;
      paint();
    });

    fields.set(id, { number, slider, paint });
  });
}

function setField(id, value) {
  const f = fields.get(id);
  if (!f) return;
  f.number.value = value;
  f.slider.value = value;
  f.paint();
}

const numField = (id) => Number($(id).value);

// ---------- карточки: общие части ----------

function parseName(full) {
  let rest = String(full || '').trim();
  const out = { star: false, st: false, sv: false, wear: null, weapon: '', skin: rest };

  if (rest.startsWith('★')) {
    out.star = true;
    rest = rest.replace(/^★\s*/, '');
  }
  if (/^StatTrak™\s/.test(rest)) {
    out.st = true;
    rest = rest.replace(/^StatTrak™\s+/, '');
  }
  if (/^Souvenir\s/.test(rest)) {
    out.sv = true;
    rest = rest.replace(/^Souvenir\s+/, '');
  }
  const wm = rest.match(/\s\(([^()]+)\)$/);
  if (wm && WEARS[wm[1]]) {
    out.wear = wm[1];
    rest = rest.slice(0, wm.index);
  }
  const i = rest.indexOf(' | ');
  if (i >= 0) {
    out.weapon = rest.slice(0, i);
    out.skin = rest.slice(i + 3);
  } else {
    out.skin = rest;
  }
  return out;
}

/** Название в два яруса: оружие мелко, скин крупно, износ — цветным значком. */
function nameBlock(full, extra) {
  const p = parseName(full);
  const top = h('div', { class: 'nm-top' });
  if (p.star) top.append(h('span', { class: 'tag star', title: 'Нож или перчатки', text: '★' }));
  if (p.weapon) top.append(h('span', { class: 'weapon', text: p.weapon }));
  if (p.st) top.append(h('span', { class: 'tag st', text: 'StatTrak™' }));
  if (p.sv) top.append(h('span', { class: 'tag sv', text: 'Souvenir' }));
  for (const x of [].concat(extra || [])) if (x) top.append(x);

  const title = h('div', { class: 'nm-title' }, h('b', { title: full, text: p.skin }));
  if (p.wear) {
    title.append(h('span', { class: 'tag wear ' + WEARS[p.wear].cls, title: p.wear, text: WEARS[p.wear].abbr }));
  }
  return h('div', { class: 'nm' }, top, title);
}

function thumb(deal) {
  const t = h('div', { class: 'thumb' }, icon(GLYPHS[deal.itemType] || 'g-box', 'ico glyph'));
  if (deal.iconUrl) {
    const img = h('img', { alt: '', loading: 'lazy', src: iconSrc(deal.iconUrl) });
    img.addEventListener('load', () => t.classList.add('loaded'));
    img.addEventListener('error', () => img.remove());
    t.append(img);
  }
  return t;
}

/** Шкала износа: пять диапазонов в реальных пропорциях, белая метка — float предмета. */
function floatBar(value) {
  const marker = h('b');
  marker.style.left = Math.min(100, Math.max(0, value * 100)) + '%';
  return h('span', { class: 'floatbar' }, h('i'), h('i'), h('i'), h('i'), h('i'), marker);
}

function dealChips(deal) {
  const chips = [];
  if (deal.floatValue !== null) {
    const chip = h('span', { class: 'chip', title: 'Float ' + deal.floatValue.toFixed(6) },
      floatBar(deal.floatValue), h('b', { text: deal.floatValue.toFixed(4) }));
    if (deal.floatPremiumPercent !== null) {
      const p = deal.floatPremiumPercent;
      chip.append(h('span', { text: (p >= 0 ? '+' : '') + p.toFixed(1) + '%', title: 'Премия за float к базовой цене' }));
    }
    chips.push(chip);
  }
  if (deal.stickers && deal.stickers.totalUsd > 0) {
    chips.push(h('span', { class: 'chip', title: 'Суммарная цена наклеек' }, 'стикеры ', h('b', { text: usd(deal.stickers.totalUsd) })));
  }
  if (deal.liquidity !== null) {
    chips.push(h('span', { class: 'chip', title: 'Продаж в сутки' }, 'ликв. ', h('b', { text: num(deal.liquidity) })));
  }
  chips.push(h('span', { class: 'chip', title: 'Продавец' }, h('b', { text: deal.seller.name }), num(deal.seller.trades) + ' трейдов'));
  return h('div', { class: 'chips' }, chips);
}

function dealCard(deal, { fresh = false } = {}) {
  const tier = tierOf(deal);
  const el = h('article', { class: 'deal t-' + tier.key + (fresh ? ' fresh' : '') });

  const ago = h('span', {
    class: 'ago',
    dataset: { found: deal.foundAt },
    title: 'Листингу было ' + fmtAge(deal.ageSeconds) + ' на момент находки',
    text: agoText(deal.foundAt)
  });
  const badge = tier.label ? h('span', { class: 'tag tier', text: tier.label }) : null;

  const info = h('div', null, nameBlock(deal.name, [badge, ago]), dealChips(deal));

  const open = h('button', { class: 'btn sm', onclick: () => window.api.openItem(deal.url) }, icon('i-ext'), 'Открыть лот');

  const already = boughtIds.has(deal.id);
  const bought = h('button', { class: 'btn sm' + (already ? ' done' : ''), disabled: already },
    icon('i-check'), already ? 'В журнале' : 'Куплено');
  bought.addEventListener('click', async () => {
    bought.disabled = true;
    const res = await window.api.journalAdd({
      name: deal.name,
      buyPriceUsd: deal.priceUsd,
      referenceAtBuyUsd: deal.referenceUsd,
      floatValue: deal.floatValue,
      itemUrl: deal.url,
      source: 'alert'
    });
    if (!res.ok) {
      notify(problemsText(res), 'error', 8000);
      bought.disabled = false;
      return;
    }
    boughtIds.add(deal.id);
    applyJournal(res);
    bought.classList.add('done');
    bought.replaceChildren(icon('i-check'), 'В журнале');
    notify('Добавлено в журнал: ' + deal.name, 'ok');
  });

  const price = h('div', { class: 'price' },
    h('div', { class: 'now', text: usd(deal.priceUsd) }),
    h('div', { class: 'gain' },
      h('span', { class: 'disc', text: '−' + deal.discountPercent.toFixed(1) + '%' }),
      h('span', { class: 'profit', text: '+' + usd(deal.profitUsd) })),
    h('div', { class: 'ref', text: 'от ' + usd(deal.referenceUsd) + ' · ' + (REF_LABELS[deal.referenceSource] || deal.referenceSource) }),
    h('div', { class: 'deal-actions' }, open, bought));

  el.append(thumb(deal), info, price);
  return el;
}

// «Найдено N минут назад» тикает без перерисовки карточек.
function updateAgo() {
  $$('.ago[data-found]').forEach((el) => { el.textContent = agoText(el.dataset.found); });
}

// ---------- лента алертов ----------

function sortedDeals() {
  const list = dealsData.slice();
  if (dealSort === 'discount') list.sort((a, b) => b.discountPercent - a.discountPercent);
  else if (dealSort === 'profit') list.sort((a, b) => b.profitUsd - a.profitUsd);
  return list;
}

function renderDeals() {
  $('deals').replaceChildren(...sortedDeals().map((d) => dealCard(d)));
  renderDrops();
  syncEmpty();
}

/** Плитка живой ленты: картинка, цена и скидка в цвете уровня. */
function dropTile(deal, isNew) {
  const tier = tierOf(deal);
  const tile = h('button', {
    type: 'button',
    class: 'drop t-' + tier.key + (isNew ? ' new' : ''),
    title: deal.name + ' — открыть лот',
    onclick: () => window.api.openItem(deal.url)
  });
  if (deal.iconUrl) {
    const img = h('img', { alt: '', src: iconSrc(deal.iconUrl) });
    img.addEventListener('error', () => img.replaceWith(icon(GLYPHS[deal.itemType] || 'g-box')));
    tile.append(img);
  } else {
    tile.append(icon(GLYPHS[deal.itemType] || 'g-box'));
  }
  tile.append(
    h('span', { class: 'drop-price', text: usd(deal.priceUsd) }),
    h('span', { class: 'drop-disc', text: '−' + Math.round(deal.discountPercent) + '%' }));
  return tile;
}

// Лента идёт строго по времени находки, независимо от сортировки карточек.
function renderDrops() {
  const box = $('drops');
  const label = box.firstElementChild;
  box.replaceChildren(label, ...dealsData.slice(0, MAX_DROPS).map((d) => dropTile(d, false)));
  box.hidden = dealsData.length === 0;
  $('legend').hidden = dealsData.length === 0;
}

function pushDrop(deal) {
  const box = $('drops');
  box.firstElementChild.after(dropTile(deal, true));
  while (box.children.length > MAX_DROPS + 1) box.lastElementChild.remove();
  box.hidden = false;
  $('legend').hidden = false;
}

function addDeal(deal) {
  dealsData.unshift(deal);
  if (dealsData.length > MAX_DEALS) dealsData.length = MAX_DEALS;

  if (dealSort === 'new') {
    const list = $('deals');
    list.prepend(dealCard(deal, { fresh: true }));
    while (list.children.length > MAX_DEALS) list.lastElementChild.remove();
    pushDrop(deal);
    syncEmpty();
  } else {
    renderDeals();
  }
  if (currentTab !== 'alerts') setBadge(unseen + 1);
}

$$('.seg-btn[data-sort]').forEach((btn) => {
  btn.addEventListener('click', () => {
    dealSort = btn.dataset.sort;
    $$('.seg-btn[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
    renderDeals();
  });
});

/** Пустая лента подсказывает следующий шаг: ключ → запуск → ожидание. */
function syncEmpty() {
  const box = $('dealsEmpty');
  const has = dealsData.length > 0;
  box.hidden = has;
  if (has || !state) return;

  const running = !!state.running;
  const hasKey = !!state.apiKeyMask;
  const action = $('emptyAction');

  $('emptyArt').classList.toggle('scan', running);
  $('emptySteps').hidden = running;
  action.hidden = running;

  if (running) {
    $('emptyTitle').textContent = 'Сканирую рынок…';
    $('emptyText').textContent = 'Первая находка появится здесь сразу. Окно можно свернуть в трей — придёт уведомление.';
  } else if (!hasKey) {
    $('emptyTitle').textContent = 'Начнём с API-ключа';
    $('emptyText').textContent = 'Без ключа CSFloat приложение не видит ленту листингов. Ключ хранится только на этом компьютере.';
    action.textContent = 'Добавить ключ';
    action.onclick = () => goSettings('connection');
  } else {
    $('emptyTitle').textContent = 'Всё готово к запуску';
    $('emptyText').textContent = 'Запустите мониторинг — выгодные листинги появятся здесь карточками.';
    action.textContent = 'Запустить';
    action.onclick = () => $('toggleBtn').click();
  }

  $$('#emptySteps li').forEach((li) => {
    const step = li.dataset.step;
    li.classList.toggle('done', step === 'key' && hasKey);
    li.classList.toggle('current', (step === 'key' && !hasKey) || (step === 'filters' && hasKey));
  });
}

function renderStats(stats) {
  if (!stats) return;
  lastStats = stats;
  animateNumber($('statScanned'), stats.scanned, fmtCount);
  animateNumber($('statMatched'), stats.matched, fmtCount);

  if (stats.quota) {
    $('statQuota').textContent = num(stats.quota.remaining) + ' / ' + num(stats.quota.limit);
    const pct = stats.quota.limit > 0 ? (stats.quota.remaining / stats.quota.limit) * 100 : 0;
    const fill = $('quotaFill');
    fill.style.width = Math.min(100, pct) + '%';
    fill.parentElement.classList.toggle('low', pct < 20);
  }
  if (stats.delayMs) $('statDelay').textContent = Math.round(stats.delayMs / 1000) + ' с';
  syncRunSub();
}

function syncRunSub() {
  $('runSub').textContent = state && state.running
    ? num(lastStats.scanned) + ' просмотрено · ' + num(lastStats.matched) + ' сделок'
    : 'Мониторинг остановлен';
}

function renderRunning(running) {
  document.body.classList.toggle('is-running', running);
  $('statusDot').classList.toggle('on', running);
  $('statusText').textContent = running ? 'Мониторинг идёт' : 'Остановлен';

  const btn = $('toggleBtn');
  btn.classList.toggle('primary', !running);
  btn.classList.toggle('stop', running);
  btn.title = running ? 'Остановить мониторинг' : 'Запустить мониторинг';
  $('toggleLabel').textContent = running ? 'Остановить' : 'Запустить';
  $('toggleIcon').setAttribute('href', running ? '#i-stop' : '#i-play');

  syncRunSub();
  syncEmpty();
}

function renderKeyState() {
  const el = $('keyState');
  if (state.apiKeyMask) {
    el.textContent = 'Сохранён: ' + state.apiKeyMask + (state.encryptionAvailable
      ? ' · зашифрован средствами Windows'
      : ' · шифрование недоступно, хранится открытым текстом');
    el.classList.add('ok');
  } else {
    el.textContent = 'Ключ не задан';
    el.classList.remove('ok');
  }
}

// ---------- пресеты ----------

function renderPresets() {
  const grid = $('presetGrid');
  grid.replaceChildren();
  for (const p of state.presets) {
    const card = h('div', { class: 'preset' + (p.id === activePresetId ? ' active' : '') },
      h('button', { type: 'button', class: 'preset-main', onclick: () => applyPreset(p) },
        h('span', { class: 'preset-name' }, p.name, p.builtin ? null : h('span', { class: 'tag mine', text: 'свой' })),
        h('span', { class: 'preset-hint', text: p.hint })));

    if (!p.builtin) {
      card.append(h('button', {
        type: 'button',
        class: 'icon-btn preset-del',
        title: 'Удалить пресет',
        'aria-label': 'Удалить пресет ' + p.name,
        onclick: () => deletePreset(p)
      }, icon('i-trash')));
    }
    grid.append(card);
  }
}

// Пресет меняет только параметры поиска — автопокупку, Telegram и опрос не трогает.
const FILTER_GROUPS = ['price', 'discount', 'listing', 'types', 'premium', 'accentMarketHashName'];

function applyPreset(preset) {
  // Пресет накладывается на форму, но не сохраняется, пока не нажали «Сохранить».
  for (const [group, value] of Object.entries(preset.patch)) {
    if (!FILTER_GROUPS.includes(group)) continue;
    if (value && typeof value === 'object') {
      state.settings[group] = { ...state.settings[group], ...value };
    } else {
      state.settings[group] = value;
    }
  }
  fillForm();
  activePresetId = preset.id;
  renderPresets();
  setDirty(true);
  notify('Пресет «' + preset.name + '» применён — не забудьте сохранить', 'info');
}

async function deletePreset(preset) {
  const res = await window.api.deletePreset(preset.id);
  state.presets = res.presets;
  if (activePresetId === preset.id) activePresetId = null;
  renderPresets();
  notify('Пресет удалён', 'info', 3000);
}

$('savePresetBtn').addEventListener('click', async () => {
  const name = $('presetName').value.trim();
  if (!name) {
    notify('Введите имя пресета', 'warn');
    $('presetName').focus();
    return;
  }
  // Пресет пишется из сохранённых настроек, поэтому сперва сохраняем форму.
  const settings = collectSettings();
  const saved = await window.api.saveSettings(settings);
  if (!saved.ok) {
    notify(problemsText(saved), 'error', 8000);
    return;
  }
  state.settings = settings;
  setDirty(false);

  const res = await window.api.savePreset(name);
  if (!res.ok) {
    notify(problemsText(res), 'error', 8000);
    return;
  }
  state.presets = res.presets;
  $('presetName').value = '';
  renderPresets();
  notify('Пресет «' + name + '» сохранён', 'ok');
});

// ---------- форма настроек ----------

function fillForm() {
  const s = state.settings;

  setField('minPrice', s.price.minUsd);
  setField('maxPrice', s.price.maxUsd);
  setField('minDiscount', s.discount.minPercent);
  setField('minProfit', s.discount.minProfitUsd);
  setField('maxAge', s.listing.maxAgeMinutes);
  setField('minTrades', s.listing.minSellerTrades);
  setField('minLiquidity', s.listing.minLiquidity);
  setField('maxFloatPremium', s.premium.maxFloatPercent);
  setField('stickerStrictness', s.premium.stickerStrictness);
  setField('autoBuyMaxOrder', s.autoBuy.maxOrderUsd);
  setField('autoBuyDaily', s.autoBuy.dailyLimitUsd);
  setField('pollSec', Math.round(s.poll.intervalMs / 1000));
  setField('pollLimit', s.poll.limit);

  $('autoBuyEnabled').checked = s.autoBuy.enabled;
  const modeInput = document.querySelector('input[name="autoBuyMode"][value="' + s.autoBuy.mode + '"]');
  if (modeInput) modeInput.checked = true;
  $('autoBuyConfirm').checked = s.autoBuy.confirmEach;

  $('accent').value = s.accentMarketHashName;

  $('tgEnabled').checked = s.telegram.enabled;
  $('tgToken').value = s.telegram.botToken;
  $('tgChat').value = s.telegram.chatId;

  const box = $('types');
  box.replaceChildren();
  for (const key of Object.keys(TYPE_LABELS)) {
    const input = h('input', { type: 'checkbox', dataset: { type: key } });
    input.checked = !!s.types[key];
    box.append(h('label', { class: 'type' }, input, h('span', { text: TYPE_LABELS[key] })));
  }

  $('prefNotifications').checked = state.prefs.notifications;
  $('prefSound').checked = state.prefs.sound;
  $('prefOpenInApp').checked = state.prefs.openInApp;
  $('prefTray').checked = state.prefs.minimizeToTray;
  $('prefAutoStart').checked = state.prefs.autoStart;

  renderKeyState();
}

function collectSettings() {
  const s = JSON.parse(JSON.stringify(state.settings));

  s.price.minUsd = numField('minPrice');
  s.price.maxUsd = numField('maxPrice');
  s.discount.minPercent = numField('minDiscount');
  s.discount.minProfitUsd = numField('minProfit');
  s.listing.maxAgeMinutes = numField('maxAge');
  s.listing.minSellerTrades = numField('minTrades');
  s.listing.minLiquidity = numField('minLiquidity');
  s.premium.maxFloatPercent = numField('maxFloatPremium');
  s.premium.stickerStrictness = numField('stickerStrictness');
  s.autoBuy.enabled = $('autoBuyEnabled').checked;
  s.autoBuy.mode = document.querySelector('input[name="autoBuyMode"]:checked').value;
  s.autoBuy.confirmEach = $('autoBuyConfirm').checked;
  s.autoBuy.maxOrderUsd = numField('autoBuyMaxOrder');
  s.autoBuy.dailyLimitUsd = numField('autoBuyDaily');
  s.poll.intervalMs = Math.max(2, numField('pollSec')) * 1000;
  s.poll.limit = numField('pollLimit');

  s.accentMarketHashName = $('accent').value.trim();

  s.telegram.enabled = $('tgEnabled').checked;
  s.telegram.botToken = $('tgToken').value.trim();
  s.telegram.chatId = $('tgChat').value.trim();

  $$('#types input').forEach((i) => {
    s.types[i.dataset.type] = i.checked;
  });

  return s;
}

function collectPrefs() {
  return {
    notifications: $('prefNotifications').checked,
    sound: $('prefSound').checked,
    openInApp: $('prefOpenInApp').checked,
    minimizeToTray: $('prefTray').checked,
    autoStart: $('prefAutoStart').checked
  };
}

// Панель сохранения подсказывает, что в форме есть несохранённые правки.
function setDirty(value) {
  dirty = value;
  $('saveBar').classList.toggle('dirty', value);
  $('saveStateText').textContent = value ? 'Есть несохранённые изменения' : 'Все изменения сохранены';
}

['input', 'change'].forEach((type) => {
  $('tab-settings').addEventListener(type, (ev) => {
    if (ev.target.closest('[data-nodirty]')) return;
    if (!dirty) setDirty(true);
    // Правка вручную уводит форму от пресета — подсветка больше не честна.
    if (activePresetId && ev.target.closest('#pane-filters') && !ev.target.closest('.preset')) {
      activePresetId = null;
      renderPresets();
    }
  });
});

async function saveAll() {
  const settings = collectSettings();
  const prefs = collectPrefs();
  const res = await window.api.saveSettings(settings);
  await window.api.savePrefs(prefs);
  if (!res.ok) {
    notify(problemsText(res), 'error', 8000);
    return false;
  }
  state.settings = settings;
  state.prefs = { ...state.prefs, ...prefs };
  setDirty(false);
  notify('Настройки сохранены', 'ok', 2600);
  return true;
}

$('saveBtn').addEventListener('click', saveAll);
$('goDryBtn').addEventListener('click', () => switchPane('dry'));

document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && currentTab === 'settings') {
    ev.preventDefault();
    saveAll();
  }
});

// ---------- запуск, ключ, поддержка ----------

$('toggleBtn').addEventListener('click', async () => {
  const res = state.running ? await window.api.stop() : await window.api.start();
  if (!res.ok && res.problems) notify(problemsText(res), 'error', 8000);
  if (res.ok) {
    $('banner').hidden = true;
    // Новый запуск считает с нуля — не показываем цифры прошлого.
    if (!state.running && res.running) {
      lastStats = { scanned: 0, matched: 0 };
      renderStats(lastStats);
    }
  }
  state.running = res.running;
  renderRunning(state.running);
});

$('saveKeyBtn').addEventListener('click', async () => {
  const wasRunning = state.running;
  const res = await window.api.setApiKey($('apiKey').value);
  $('apiKey').value = '';
  state.apiKeyMask = res.apiKeyMask;
  state.running = res.running;
  renderKeyState();
  renderRunning(state.running);
  const text = res.apiKeyMask ? 'Ключ сохранён' : 'Ключ удалён';
  notify(wasRunning && state.running ? text + ', мониторинг перезапущен' : text, 'ok', 3500);
});

$('tgTestBtn').addEventListener('click', async () => {
  const btn = $('tgTestBtn');
  const label = btn.querySelector('span');
  const status = $('tgTestState');
  btn.disabled = true;
  label.textContent = 'Отправляю…';
  status.textContent = '';
  try {
    const res = await window.api.telegramTest($('tgToken').value.trim(), $('tgChat').value.trim());
    status.textContent = res.ok ? 'Сообщение отправлено — проверьте Telegram' : problemsText(res);
    status.className = 'hint ' + (res.ok ? 'positive' : 'negative');
  } finally {
    btn.disabled = false;
    label.textContent = 'Отправить тест';
  }
});

const openSupport = () => window.api.openSupport();
$('supportBtn').addEventListener('click', openSupport);
$('aboutSupportBtn').addEventListener('click', openSupport);

// ---------- ордера ----------

function orderRow(o) {
  const info = h('div', null,
    nameBlock(o.market_hash_name || 'без названия'),
    h('div', { class: 'chips' },
      h('span', { class: 'chip', text: 'кол-во ' + (o.qty ?? 1) }),
      o.created_at ? h('span', { class: 'chip', text: 'поставлен ' + new Date(o.created_at).toLocaleString('ru-RU') }) : null));

  const nums = h('div', { class: 'jnums' }, h('div', { class: 'jbuy', text: 'до ' + usd((o.price || 0) / 100) }));

  const del = h('button', { class: 'btn danger sm' }, icon('i-trash'), 'Снять ордер');
  del.addEventListener('click', async () => {
    del.disabled = true;
    const res = await window.api.ordersDelete(o.id);
    if (!res.ok) {
      notify(problemsText(res), 'error', 8000);
      del.disabled = false;
      return;
    }
    notify('Ордер снят', 'ok', 3000);
    loadOrders();
  });

  return h('article', { class: 'jrow order' }, info, nums, h('div', { class: 'jactions' }, del));
}

async function loadOrders() {
  const res = await window.api.ordersList();
  const list = $('ordersList');
  list.replaceChildren();

  if (!res.ok) {
    $('ordersEmpty').hidden = false;
    $('spentToday').textContent = '—';
    $('spentLimit').textContent = '';
    $('spentFill').style.width = '0%';
    if (res.problems.length > 0) notify(problemsText(res), 'error', 8000);
    return;
  }

  const spent = res.spentTodayUsd || 0;
  const limit = res.dailyLimitUsd || 0;
  $('spentToday').textContent = usd(spent);
  $('spentLimit').textContent = 'из ' + usd(limit);

  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
  const fill = $('spentFill');
  fill.style.width = pct + '%';
  fill.parentElement.classList.toggle('low', pct >= 70 && pct < 100);
  fill.parentElement.classList.toggle('over', pct >= 100);

  $('ordersEmpty').hidden = res.orders.length > 0;
  for (const o of res.orders) list.append(orderRow(o));
}

$('refreshOrdersBtn').addEventListener('click', loadOrders);

// ---------- журнал ----------

function applyJournal(payload) {
  state.journal = payload.journal;
  state.journalStats = payload.journalStats;
  renderJournal();
}

/** Накопленная реализованная прибыль по датам продаж — маленький график в шапке. */
function renderSpark(entries) {
  const svg = $('pnlSpark');
  svg.replaceChildren();
  const pnl = svg.closest('.pnl');

  const sold = entries
    .filter((e) => e.sellPriceUsd !== null && e.sellPriceUsd !== undefined && e.soldAt)
    .sort((a, b) => Date.parse(a.soldAt) - Date.parse(b.soldAt));
  if (sold.length < 2) {
    pnl.classList.add('no-spark');
    return;
  }
  pnl.classList.remove('no-spark');

  let acc = 0;
  const values = [0];
  for (const e of sold) {
    acc += e.sellPriceUsd - e.buyPriceUsd;
    values.push(acc);
  }

  const W = 220;
  const H = 64;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 4 - ((v - min) / span) * (H - 8)]);

  const line = pts.map(([x, y]) => x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('class', 'area');
  area.setAttribute('d', 'M0,' + H + ' L' + line.replace(/ /g, ' L') + ' L' + W + ',' + H + ' Z');
  const poly = document.createElementNS(SVG_NS, 'polyline');
  poly.setAttribute('class', 'line');
  poly.setAttribute('points', line);

  svg.classList.toggle('neg', acc < 0);
  svg.append(area, poly);
}

function renderPnl() {
  const s = state.journalStats;
  const realized = $('pnlRealized');
  animateNumber(realized, s.realizedUsd, usd);
  realized.className = s.realizedUsd > 0 ? 'positive' : s.realizedUsd < 0 ? 'negative' : '';

  // Лучшая сделка и доля продаж в плюс — считаем по проданным позициям журнала.
  const profits = state.journal
    .filter((e) => e.sellPriceUsd !== null && e.sellPriceUsd !== undefined)
    .map((e) => e.sellPriceUsd - e.buyPriceUsd);
  const best = $('pnlBest');
  best.textContent = profits.length > 0 ? signed(Math.max(...profits)) : '—';
  best.className = profits.length > 0 && Math.max(...profits) > 0 ? 'positive' : '';
  $('pnlWinrate').textContent = profits.length > 0
    ? Math.round((profits.filter((p) => p > 0).length / profits.length) * 100) + '%'
    : '—';

  $('pnlPercent').textContent = (s.realizedPercent >= 0 ? '+' : '') + s.realizedPercent.toFixed(1) + '%' +
    (s.soldCount > 0 ? ' по ' + s.soldCount + ' продажам' : '');
  $('pnlInvested').textContent = usd(s.investedUsd);
  $('pnlHolding').textContent = usd(s.holdingUsd);
  $('pnlRevenue').textContent = usd(s.revenueUsd);
  $('pnlCount').textContent = s.openCount + ' / ' + s.count;
}

function journalRow(e) {
  const sold = e.sellPriceUsd !== null && e.sellPriceUsd !== undefined;
  const profit = sold ? e.sellPriceUsd - e.buyPriceUsd : null;
  const row = h('article', { class: 'jrow' + (sold ? (profit > 0 ? ' win' : profit < 0 ? ' loss' : '') : '') });

  const chips = h('div', { class: 'chips' },
    h('span', { class: 'chip', text: 'куплен ' + new Date(e.boughtAt).toLocaleDateString('ru-RU') }),
    e.referenceAtBuyUsd !== null ? h('span', { class: 'chip' }, 'оценка ', h('b', { text: usd(e.referenceAtBuyUsd) })) : null,
    e.floatValue !== null ? h('span', { class: 'chip' }, floatBar(e.floatValue), h('b', { text: e.floatValue.toFixed(4) })) : null,
    e.source === 'manual' ? h('span', { class: 'chip', text: 'вручную' }) : null,
    e.note ? h('span', { class: 'chip', text: e.note }) : null);

  const status = sold
    ? h('span', { class: 'tag push ' + (profit > 0 ? 'win' : profit < 0 ? 'loss' : ''), text: 'Продано' })
    : h('span', { class: 'tag push mine', text: 'В портфеле' });

  const info = h('div', null, nameBlock(e.name, status), chips);

  const nums = h('div', { class: 'jnums' }, h('div', { class: 'jbuy', text: usd(e.buyPriceUsd) }));
  if (sold) {
    const percent = e.buyPriceUsd > 0 ? (profit / e.buyPriceUsd) * 100 : 0;
    nums.append(
      h('div', { class: 'jsold', text: '→ ' + usd(e.sellPriceUsd) }),
      h('span', {
        class: 'jprofit ' + (profit > 0 ? 'positive' : profit < 0 ? 'negative' : ''),
        text: signed(profit) + ' · ' + (percent >= 0 ? '+' : '') + percent.toFixed(0) + '%'
      }));
  }

  const actions = h('div', { class: 'jactions' });

  if (e.itemUrl) {
    actions.append(h('button', {
      class: 'icon-btn', title: 'Открыть лот', 'aria-label': 'Открыть лот',
      onclick: () => window.api.openItem(e.itemUrl)
    }, icon('i-ext')));
  }

  if (!sold) {
    const price = h('input', { type: 'number', min: '0', step: '0.01', placeholder: 'продал за', class: 'jsell', 'aria-label': 'Цена продажи на руки' });
    const sell = h('button', { class: 'btn primary sm', text: 'Продано' });
    sell.addEventListener('click', async () => {
      if (price.value === '') {
        notify('Укажите, за сколько продали (на руки, после комиссии)', 'warn');
        price.focus();
        return;
      }
      const res = await window.api.journalSell(e.id, Number(price.value));
      if (!res.ok) {
        notify(problemsText(res), 'error', 8000);
        return;
      }
      applyJournal(res);
    });
    actions.append(price, sell);
  } else {
    actions.append(h('button', {
      class: 'icon-btn', title: 'Вернуть в портфель', 'aria-label': 'Вернуть в портфель',
      onclick: async () => {
        const res = await window.api.journalSell(e.id, null);
        if (res.ok) applyJournal(res);
      }
    }, icon('i-undo')));
  }

  actions.append(h('button', {
    class: 'icon-btn', title: 'Удалить запись', 'aria-label': 'Удалить запись',
    onclick: async () => {
      const res = await window.api.journalDelete(e.id);
      if (res.ok) applyJournal(res);
    }
  }, icon('i-trash')));

  row.append(info, nums, actions);
  return row;
}

function renderJournal() {
  renderPnl();
  renderSpark(state.journal);

  const filtered = state.journal.filter((e) => {
    const sold = e.sellPriceUsd !== null && e.sellPriceUsd !== undefined;
    if (journalFilter === 'open') return !sold;
    if (journalFilter === 'sold') return sold;
    return true;
  });

  const empty = filtered.length === 0;
  $('journalEmpty').hidden = !empty;
  if (empty) {
    const filteredOut = state.journal.length > 0;
    $('journalEmptyTitle').textContent = filteredOut ? 'В этой категории пусто' : 'Журнал пуст';
    $('journalEmptyText').textContent = filteredOut
      ? 'Переключите фильтр, чтобы увидеть остальные позиции.'
      : 'Нажмите «Куплено» на карточке алерта — позиция попадёт сюда и начнёт считаться в прибыль.';
  }

  $('journalList').replaceChildren(...filtered.map(journalRow));
}

$$('.seg-btn[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.seg-btn[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
    journalFilter = btn.dataset.filter;
    renderJournal();
  });
});

$('addManualBtn').addEventListener('click', () => {
  const form = $('manualForm');
  form.hidden = !form.hidden;
  if (!form.hidden) $('manualName').focus();
});

$('manualCancel').addEventListener('click', () => { $('manualForm').hidden = true; });

$('manualForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const res = await window.api.journalAdd({
    name: $('manualName').value,
    buyPriceUsd: Number($('manualPrice').value),
    source: 'manual'
  });
  if (!res.ok) {
    notify(problemsText(res), 'error', 8000);
    return;
  }
  applyJournal(res);
  $('manualName').value = '';
  $('manualPrice').value = '';
  $('manualForm').hidden = true;
  notify('Позиция добавлена', 'ok', 3000);
});

$('exportBtn').addEventListener('click', async () => {
  const res = await window.api.journalExport();
  if (!res.ok) {
    if (res.problems.length > 0) notify(problemsText(res), 'warn');
    return;
  }
  notify('Сохранено: ' + res.path, 'ok');
});

// ---------- проверка на истории ----------

function renderBuckets(buckets, scanned) {
  const box = $('dryBuckets');
  box.replaceChildren();
  if (buckets.length === 0) {
    box.append(h('span', { class: 'muted', text: 'Ничего не отсеялось.' }));
    return;
  }
  buckets.forEach((b, i) => {
    const fill = h('div', { class: 'bucket-fill' });
    const pct = scanned > 0 ? (b.count / scanned) * 100 : 0;
    fill.style.width = Math.max(b.count > 0 ? 1.5 : 0, pct) + '%';

    box.append(h('div', { class: 'bucket' + (i === 0 ? ' top' : '') },
      h('div', { class: 'bucket-label', text: b.label }),
      h('div', { class: 'bucket-count', text: num(b.count) }),
      h('div', { class: 'bucket-bar' }, fill),
      h('div', { class: 'bucket-sample', text: b.sample })));
  });
}

function renderDryResult(r) {
  $('dryResult').hidden = false;
  $('dryScanned').textContent = num(r.scanned);
  $('dryMatched').textContent = num(r.matched);
  $('dryCovered').textContent = Math.round(r.coveredMinutes);

  const note = $('dryNote');
  note.hidden = !r.note;
  if (r.note) note.textContent = r.note;

  renderBuckets(r.buckets, r.scanned);

  $('dryDealsTitle').hidden = r.deals.length === 0;
  $('dryDeals').replaceChildren(...r.deals.slice(0, 20).map((d) => dealCard(d)));
}

$('dryRunBtn').addEventListener('click', async () => {
  const btn = $('dryRunBtn');
  const label = btn.querySelector('span');
  const progress = $('dryProgress');

  btn.disabled = true;
  label.textContent = 'Проверяю…';
  progress.hidden = false;
  progress.textContent = 'Запрашиваю ленту CSFloat…';
  $('dryResult').hidden = true;

  const stopProgress = window.api.onDryRunProgress((p) => {
    progress.textContent = 'Страница ' + p.page + ', листингов ' + p.fetched +
      ', глубина ' + Math.round(p.oldestAgeMinutes) + ' мин';
  });

  try {
    const res = await window.api.dryRun(collectSettings(), Number($('dryWindow').value));
    if (!res.ok) {
      notify(problemsText(res), 'error', 8000);
      return;
    }
    renderDryResult(res.result);
  } finally {
    stopProgress();
    progress.hidden = true;
    btn.disabled = false;
    label.textContent = 'Проверить';
  }
});

// ---------- старт ----------

(async () => {
  initFields();
  state = await window.api.getState();
  if (state.stats) lastStats = state.stats;

  $('appVersion').textContent = state.version ? 'v' + state.version : '';
  $('aboutVersion').textContent = state.version ? 'Версия ' + state.version : '';
  $('supportBtn').hidden = !state.supportUrl;
  $('aboutSupportBtn').hidden = !state.supportUrl;

  renderRunning(state.running);
  renderStats(state.stats);
  renderPresets();
  fillForm();
  renderJournal();
  dealsData = state.deals.slice(0, MAX_DEALS);
  renderDeals();
  setInterval(updateAgo, 20000);

  // --- события движка ---
  window.api.onDeal((deal) => addDeal(deal));
  window.api.onStats((stats) => renderStats(stats));
  window.api.onError((message, fatal) => {
    if (!fatal) {
      notify(message, 'warn', 8000);
      return;
    }
    showFatal(message);
    // Фатальная ошибка останавливает опрос — приводим кнопку в соответствие.
    window.api.getState().then((s) => {
      state.running = s.running;
      renderRunning(s.running);
    });
  });
  window.api.onJournalChanged((payload) => applyJournal(payload));
  window.api.onAutoBuy((e) => {
    if (e.kind === 'bought') {
      notify('Куплено: ' + e.name + ' за ' + usd(e.priceUsd) + ' — записано в журнал', 'ok', 8000);
    } else if (e.kind === 'placed') {
      notify('Ордер поставлен: ' + e.name + ' до ' + usd(e.priceUsd), 'ok', 8000);
      if (currentTab === 'orders') loadOrders();
    } else if (e.kind === 'failed') {
      const what = e.mode === 'direct' ? 'Не удалось выкупить' : 'Ордер не поставлен';
      notify(what + ' (' + e.name + '): ' + e.reason, 'error', 10000);
    }
    // kind === 'skipped' в уведомления не выносим: сработавший лимит это норма,
    // а не ошибка, и всплывашка на каждую сделку только мешала бы.
  });
})();
