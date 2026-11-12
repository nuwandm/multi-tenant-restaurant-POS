import type { VatRate } from '@pos/domain';
import type { Article, LineRequest, OrderLine, Station } from './api';

/** One line of the order on screen. Same item + same options = same line. */
export interface BasketLine {
  key: string;
  articleId: string;
  name: string;
  /** Chosen option names, e.g. "Large, Extra cheese". */
  options?: string;
  optionIds: string[];
  /** Base price plus options; the server prices again when the sale is made. */
  unitPriceOre: number;
  vatRate: VatRate;
  station: Station | null;
  quantity: number;
  discountOre: number;
  /** On a table order: how many have gone to the kitchen already. */
  sentQuantity: number;
}

export const lineKey = (articleId: string, optionIds: string[] = []) =>
  [articleId, ...[...optionIds].sort()].join('|');

/** A new line for an item and the options picked for it. */
export function toBasketLine(article: Article, optionIds: string[] = []): BasketLine {
  const chosen = article.optionGroups.flatMap((g) =>
    g.options.filter((o) => optionIds.includes(o.id)),
  );
  return {
    key: lineKey(article.id, optionIds),
    articleId: article.id,
    name: article.name,
    ...(chosen.length > 0 && { options: chosen.map((o) => o.name).join(', ') }),
    optionIds: chosen.map((o) => o.id),
    unitPriceOre: article.priceOre + chosen.reduce((sum, o) => sum + o.priceDeltaOre, 0),
    vatRate: article.vatRate,
    station: article.station,
    quantity: 1,
    discountOre: 0,
    sentQuantity: 0,
  };
}

export function fromOrderLine(line: OrderLine): BasketLine {
  return {
    key: line.key,
    articleId: line.articleId,
    name: line.name,
    ...(line.options && { options: line.options }),
    optionIds: line.optionIds,
    unitPriceOre: line.unitPriceOre,
    vatRate: line.vatRate,
    station: line.station,
    quantity: line.quantity,
    discountOre: line.discountOre ?? 0,
    sentQuantity: line.sentQuantity,
  };
}

/** Adds one of a line, merging with an existing line of the same item and options. */
export function addLine(lines: BasketLine[], line: BasketLine): BasketLine[] {
  return lines.some((l) => l.key === line.key)
    ? lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + line.quantity } : l))
    : [...lines, line];
}

export const lineGross = (l: BasketLine) => l.quantity * l.unitPriceOre;

export const toRequest = (lines: BasketLine[]): LineRequest[] =>
  lines.map((l) => ({
    articleId: l.articleId,
    quantity: l.quantity,
    ...(l.optionIds.length > 0 && { optionIds: l.optionIds }),
    ...(l.discountOre > 0 && { discountOre: Math.min(l.discountOre, lineGross(l)) }),
  }));
