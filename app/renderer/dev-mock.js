// Заглушка window.api для работы над интерфейсом в обычном браузере.
// В Electron preload объявляет window.api раньше — тогда этот файл ничего не делает.

if (!window.api) {
  const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();

  const sample = (over) => Object.assign({
    id: 'demo' + Math.random().toString(36).slice(2, 8),
    foundAt: ago(20),
    name: 'AK-47 | Redline (Field-Tested)',
    itemType: 'rifles',
    priceUsd: 18.4,
    referenceUsd: 21.7,
    referenceSource: 'csfloat_predicted',
    discountPercent: 15.2,
    profitUsd: 3.3,
    floatValue: 0.2384,
    floatPremiumPercent: 2.1,
    stickers: null,
    liquidity: 142,
    seller: { name: 'trader_77', trades: 318 },
    ageSeconds: 24,
    iconUrl: null,
    url: 'https://csfloat.com/item/demo'
  }, over);

  const state = {
    settings: {
      price: { minUsd: 1, maxUsd: 200 },
      discount: { minPercent: 8, minProfitUsd: 0 },
      listing: { maxAgeMinutes: 1, minSellerTrades: 0, minLiquidity: 0 },
      types: {
        stickers: false, knives: true, gloves: true, rifles: true, smgs: true,
        pistols: true, shotguns: true, machineGuns: true, music: false, other: false
      },
      premium: { maxFloatPercent: 10, stickerStrictness: 1 },
      autoBuy: { enabled: false, mode: 'direct', maxOrderUsd: 20, dailyLimitUsd: 100, confirmEach: true },
      poll: { intervalMs: 8000, limit: 50 },
      accentMarketHashName: '',
      telegram: { enabled: false, botToken: '', chatId: '' }
    },
    prefs: {
      autoStart: false, minimizeToTray: true, notifications: true,
      sound: true, openInApp: true, window: { width: 1180, height: 820 }
    },
    running: true,
    stats: { scanned: 1284, matched: 5, startedAt: Date.now(), lastListingAt: Date.now(), quota: { remaining: 812, limit: 1000, resetUnix: 0 }, delayMs: 8000 },
    deals: [
      sample({
        name: 'StatTrak™ USP-S | Kill Confirmed (Minimal Wear)',
        itemType: 'pistols',
        priceUsd: 51.8,
        referenceUsd: 66.0,
        discountPercent: 21.5,
        profitUsd: 14.2,
        floatValue: 0.0831,
        floatPremiumPercent: 1.2,
        liquidity: 64,
        seller: { name: 'kc_dealer', trades: 902 },
        ageSeconds: 9,
        foundAt: ago(6)
      }),
      sample({ foundAt: ago(58) }),
      sample({
        name: '★ Karambit | Doppler (Factory New)',
        itemType: 'knives',
        priceUsd: 742.5,
        referenceUsd: 858.0,
        discountPercent: 13.5,
        profitUsd: 115.5,
        floatValue: 0.0132,
        floatPremiumPercent: 4.4,
        liquidity: 11,
        seller: { name: 'knifeguy', trades: 1204 },
        ageSeconds: 41,
        foundAt: ago(190)
      }),
      sample({
        name: 'AWP | Asiimov (Well-Worn)',
        priceUsd: 54.1,
        referenceUsd: 61.9,
        referenceSource: 'steam_scm',
        discountPercent: 12.6,
        profitUsd: 7.8,
        floatValue: 0.4021,
        floatPremiumPercent: null,
        stickers: { totalUsd: 6.4, paidUsd: 0.9 },
        liquidity: 87,
        seller: { name: 'skinshop', trades: 55 },
        ageSeconds: 12,
        foundAt: ago(420)
      }),
      sample({
        name: '★ Sport Gloves | Vice (Field-Tested)',
        itemType: 'gloves',
        priceUsd: 214.0,
        referenceUsd: 236.5,
        referenceSource: 'csfloat_base',
        discountPercent: 9.5,
        profitUsd: 22.5,
        floatValue: 0.2711,
        floatPremiumPercent: -1.8,
        liquidity: 6,
        seller: { name: 'glove_hub', trades: 233 },
        ageSeconds: 33,
        foundAt: ago(1500)
      })
    ],
    journal: [
      { id: 'j1', name: 'AK-47 | Redline (Field-Tested)', boughtAt: '2026-08-28T12:00:00.000Z', buyPriceUsd: 18.4, referenceAtBuyUsd: 21.7, floatValue: 0.2384, itemUrl: 'https://csfloat.com/item/demo', source: 'alert', soldAt: '2026-08-30T09:00:00.000Z', sellPriceUsd: 21.1, note: '' },
      { id: 'j2', name: '★ Karambit | Doppler (Factory New)', boughtAt: '2026-08-29T18:30:00.000Z', buyPriceUsd: 742.5, referenceAtBuyUsd: 858, floatValue: 0.0132, itemUrl: 'https://csfloat.com/item/demo2', source: 'alert', soldAt: null, sellPriceUsd: null, note: '' },
      { id: 'j3', name: 'AWP | Asiimov (Well-Worn)', boughtAt: '2026-08-31T08:15:00.000Z', buyPriceUsd: 54.1, referenceAtBuyUsd: 61.9, floatValue: 0.4021, itemUrl: null, source: 'manual', soldAt: '2026-09-01T20:00:00.000Z', sellPriceUsd: 49.0, note: '' }
    ],
    journalStats: { count: 3, openCount: 1, soldCount: 2, investedUsd: 815, holdingUsd: 742.5, revenueUsd: 70.1, costOfSoldUsd: 72.5, realizedUsd: -2.4, realizedPercent: -3.31 },
    apiKeyMask: '••••••••••••3f9a',
    encryptionAvailable: true,
    version: '0.1.0',
    supportUrl: 'https://example.com/support',
    presets: [
      { id: 'cheap-flips', name: 'Дешёвые флипы', hint: 'До $20, скидка от 12%. Много сигналов, низкий риск на сделку.', builtin: true, patch: { price: { minUsd: 1, maxUsd: 20 } } },
      { id: 'liquid', name: 'Только ликвидное', hint: 'Предметы, которые реально продаются: от 20 продаж в день.', builtin: true, patch: { listing: { minLiquidity: 20 } } },
      { id: 'knives-gloves', name: 'Ножи и перчатки', hint: 'Дорогой сегмент. Сигналов мало, выгода на сделку большая.', builtin: true, patch: { price: { minUsd: 80, maxUsd: 3000 } } },
      { id: 'stickers', name: 'Наклейки', hint: 'Только наклейки и капсулы. Свои правила переплаты.', builtin: true, patch: { price: { minUsd: 2, maxUsd: 400 } } },
      { id: 'user-вечерний', name: 'Вечерний режим', hint: 'Ваш пресет', builtin: false, patch: { price: { minUsd: 5, maxUsd: 120 } } }
    ]
  };

  window.api = {
    getState: async () => state,
    saveSettings: async () => ({ ok: true, problems: [] }),
    savePrefs: async () => ({ ok: true, prefs: state.prefs }),
    setApiKey: async () => ({ ok: true, apiKeyMask: state.apiKeyMask, running: state.running }),
    start: async () => ({ ok: true, problems: [], running: true }),
    stop: async () => ({ ok: true, running: false }),
    openItem: async () => ({ ok: true }),
    openSupport: async () => ({ ok: true }),
    telegramTest: async () => ({ ok: true, problems: [] }),
    savePreset: async () => ({ ok: true, problems: [], presets: state.presets }),
    deletePreset: async () => ({ ok: true, presets: state.presets }),
    dryRun: async () => ({
      ok: true,
      problems: [],
      result: {
        scanned: 842,
        matched: 3,
        deals: state.deals,
        windowMinutes: 60,
        coveredMinutes: 58,
        pages: 17,
        note: null,
        buckets: [
          { code: 'discount', label: 'скидка меньше порога', count: 601, sample: 'Скидка 2.4% < 8%' },
          { code: 'type', label: 'тип предмета отключён', count: 118, sample: 'Тип отключён в настройках: stickers' },
          { code: 'no_reference', label: 'нет референсной цены', count: 71, sample: 'Нет референсной цены (CSFloat не вернул reference и scm)' },
          { code: 'liquidity', label: 'низкая ликвидность', count: 34, sample: 'Низкая ликвидность: 4 < 20' },
          { code: 'float_premium', label: 'переплата за float', count: 15, sample: 'Float premium 18.3% > 10%' }
        ]
      }
    }),
    onDryRunProgress: () => () => {},
    journalList: async () => ({ journal: state.journal, journalStats: state.journalStats }),
    journalAdd: async () => ({ ok: true, problems: [], journal: state.journal, journalStats: state.journalStats }),
    journalSell: async () => ({ ok: true, problems: [], journal: state.journal, journalStats: state.journalStats }),
    journalDelete: async () => ({ ok: true, problems: [], journal: state.journal, journalStats: state.journalStats }),
    journalExport: async () => ({ ok: true, problems: [], path: 'C:\demo\journal.csv' }),
    ordersList: async () => ({
      ok: true,
      problems: [],
      spentTodayUsd: 38.4,
      dailyLimitUsd: 100,
      orders: [
        { id: 'ord1', market_hash_name: 'AK-47 | Redline (Field-Tested)', price: 1840, qty: 1, created_at: '2026-09-02T09:12:00.000Z' },
        { id: 'ord2', market_hash_name: 'AWP | Asiimov (Well-Worn)', price: 5410, qty: 1, created_at: '2026-09-02T10:40:00.000Z' }
      ]
    }),
    ordersDelete: async () => ({ ok: true, problems: [] }),
    onAutoBuy: () => () => {},
    onJournalChanged: () => () => {},
    onDeal: () => () => {},
    onStats: () => () => {},
    onError: () => () => {}
  };
}
