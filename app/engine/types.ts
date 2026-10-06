// Типы CSFloat API — только те поля, которые реально использует движок.

export interface StickerRef {
  reference?: { price?: number }; // центы
  name?: string;
}

export interface CsfloatListing {
  id: string;
  type: 'buy_now' | 'auction';
  state: 'listed' | string;
  price: number; // центы
  created_at: string;
  seller?: {
    username?: string;
    statistics?: { total_trades?: number };
  };
  item: {
    market_hash_name?: string;
    float_value?: number;
    icon_url?: string;
    stickers?: StickerRef[];
    scm?: { price?: number; volume?: number }; // центы / продаж в день
  };
  // Оценка самого CSFloat — приходит бесплатно вместе с листингом.
  reference?: {
    base_price?: number;      // центы
    predicted_price?: number; // центы, с учётом float
    float_factor?: number;    // центы, надбавка/скидка за float
    quantity?: number;        // ликвидность
  };
}

export type ItemType =
  | 'stickers' | 'knives' | 'gloves' | 'rifles' | 'smgs'
  | 'pistols' | 'shotguns' | 'machineguns' | 'music' | 'other';

/** Найденная сделка — то, что уходит в UI карточкой. */
export interface Deal {
  id: string;
  foundAt: string;          // ISO
  name: string;
  itemType: ItemType;
  priceUsd: number;
  /** Референсная цена, с которой сравнивали. */
  referenceUsd: number;
  /** Откуда взялась референсная цена — показываем в карточке. */
  referenceSource: 'csfloat_predicted' | 'csfloat_base' | 'steam_scm';
  discountPercent: number;
  profitUsd: number;
  floatValue: number | null;
  floatPremiumPercent: number | null;
  stickers: { totalUsd: number; paidUsd: number | null } | null;
  liquidity: number | null;  // продаж в день / reference.quantity
  seller: { name: string; trades: number };
  ageSeconds: number;
  iconUrl: string | null;
  url: string;
}

/**
 * Код отказа — стабильный, в отличие от текста причины. По нему dry-run
 * группирует отсев и показывает, какой фильтр режет больше всего.
 */
export type RejectCode =
  | 'no_name'
  | 'not_buy_now'
  | 'not_listed'
  | 'accent'
  | 'type'
  | 'price'
  | 'age'
  | 'trades'
  | 'liquidity'
  | 'no_reference'
  | 'sticker_premium'
  | 'float_premium'
  | 'bad_data'
  | 'discount'
  | 'profit';

/** Отказ — с причиной. Нужен для dry-run и для отладки настроек. */
export interface Rejection {
  ok: false;
  code: RejectCode;
  reason: string;
}

export type FilterResult = { ok: true; deal: Deal } | Rejection;
