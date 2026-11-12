import { ore, type Ore, type VatRate } from '@pos/domain';
import type { TransactionSql } from 'postgres';
import { HttpError } from '../errors';

export type Station = 'kitchen' | 'bar';

/** What the till sends for one line: which item, how many, which options. Never a price. */
export interface LineRequest {
  articleId: string;
  quantity: number;
  optionIds?: string[];
  discountOre?: number;
}

/** A line priced from the menu: base price plus the chosen options. */
export interface PricedLine {
  /** Same item with the same options gives the same key, so they merge into one line. */
  key: string;
  articleId: string;
  name: string;
  options?: string;
  optionIds: string[];
  quantity: number;
  unitPriceOre: Ore;
  vatRate: VatRate;
  discountOre?: Ore;
  station: Station | null;
}

export const lineKey = (articleId: string, optionIds: string[] = []) =>
  [articleId, ...[...optionIds].sort()].join('|');

interface ArticleRow {
  id: string;
  restaurant_id: string;
  name: string;
  price_ore: number;
  vat_rate: VatRate;
  active: boolean;
  station: Station | null;
}

interface GroupRow {
  article_id: string;
  group_id: string;
  name: string;
  min_select: number;
  max_select: number;
  active: boolean;
}

interface OptionRow {
  id: string;
  group_id: string;
  name: string;
  price_delta_ore: number;
  active: boolean;
  sort_order: number;
}

/**
 * Prices lines from the restaurant's own menu. Every option must belong to a group on that item,
 * and each group's min/max choices are enforced, so the till cannot invent prices or options.
 */
export async function priceLines(
  tx: TransactionSql,
  restaurantId: string,
  lines: LineRequest[],
): Promise<PricedLine[]> {
  if (lines.length === 0) return [];
  const articleIds = [...new Set(lines.map((l) => l.articleId))];
  const articles = await tx<ArticleRow[]>`
    SELECT id, restaurant_id, name, price_ore, vat_rate, active, station
    FROM articles WHERE id IN ${tx(articleIds)}`;
  const groups = await tx<GroupRow[]>`
    SELECT aog.article_id, g.id AS group_id, g.name, g.min_select, g.max_select, g.active
    FROM article_option_groups aog JOIN option_groups g ON g.id = aog.group_id
    WHERE aog.article_id IN ${tx(articleIds)}`;
  const optionIds = [...new Set(lines.flatMap((l) => l.optionIds ?? []))];
  const options =
    optionIds.length === 0
      ? []
      : await tx<OptionRow[]>`
          SELECT id, group_id, name, price_delta_ore, active, sort_order
          FROM item_options WHERE id IN ${tx(optionIds)}`;

  const articleById = new Map(articles.map((a) => [a.id, a]));
  const optionById = new Map(options.map((o) => [o.id, o]));

  return lines.map((line, i) => {
    const where = `Line ${i + 1}`;
    const article = articleById.get(line.articleId);
    if (!article || !article.active || article.restaurant_id !== restaurantId) {
      throw new HttpError(
        400,
        'article_unavailable',
        `${where}: article is not on sale at this register`,
      );
    }

    const itemGroups = groups.filter((g) => g.article_id === article.id && g.active);
    const chosen = [...new Set(line.optionIds ?? [])].map((id) => {
      const option = optionById.get(id);
      if (!option || !option.active || !itemGroups.some((g) => g.group_id === option.group_id)) {
        throw new HttpError(400, 'option_unavailable', `${where}: that option is not available`);
      }
      return option;
    });
    for (const g of itemGroups) {
      const count = chosen.filter((o) => o.group_id === g.group_id).length;
      if (count < g.min_select || count > g.max_select) {
        throw new HttpError(
          400,
          'option_choice',
          `${where}: choose ${g.min_select === g.max_select ? g.min_select : `${g.min_select}–${g.max_select}`} in ${g.name}`,
        );
      }
    }

    // Options print in menu order, so "Large, Extra cheese" reads the same every time.
    chosen.sort(
      (a, b) =>
        itemGroups.findIndex((g) => g.group_id === a.group_id) -
          itemGroups.findIndex((g) => g.group_id === b.group_id) || a.sort_order - b.sort_order,
    );
    const unitPrice = article.price_ore + chosen.reduce((sum, o) => sum + o.price_delta_ore, 0);
    if (unitPrice < 0) throw new HttpError(400, 'option_unavailable', `${where}: price below zero`);

    const ids = chosen.map((o) => o.id);
    return {
      key: lineKey(article.id, ids),
      articleId: article.id,
      name: article.name,
      ...(chosen.length > 0 && { options: chosen.map((o) => o.name).join(', ') }),
      optionIds: ids,
      quantity: line.quantity,
      unitPriceOre: ore(unitPrice),
      vatRate: article.vat_rate,
      ...(line.discountOre !== undefined && { discountOre: ore(line.discountOre) }),
      station: article.station,
    };
  });
}

/** One kitchen or bar ticket per station that has something to make. */
export async function createKitchenTickets(
  tx: TransactionSql,
  ticket: {
    tenantId: string;
    restaurantId: string;
    createdBy: string;
    label: string;
    training: boolean;
    openOrderId?: string | null;
    receiptId?: string | null;
  },
  lines: { name: string; options?: string; quantity: number; station: Station | null }[],
): Promise<number> {
  const byStation = new Map<
    Station,
    { name: string; options: string | null; quantity: number }[]
  >();
  for (const l of lines) {
    if (!l.station || l.quantity <= 0) continue;
    const list = byStation.get(l.station) ?? [];
    list.push({ name: l.name, options: l.options ?? null, quantity: l.quantity });
    byStation.set(l.station, list);
  }
  if (byStation.size === 0) return 0;

  // Ticket numbers restart each day per restaurant; the lock keeps them unique.
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'tickets:' + ticket.restaurantId}, 0))`;
  const [row] = await tx<{ last: number }[]>`
    SELECT coalesce(max(ticket_no), 0)::int AS last FROM kitchen_tickets
    WHERE restaurant_id = ${ticket.restaurantId}
      AND created_at >= (now() AT TIME ZONE 'Europe/Stockholm')::date AT TIME ZONE 'Europe/Stockholm'`;
  let next = row!.last;
  for (const [station, stationLines] of byStation) {
    next += 1;
    await tx`
      INSERT INTO kitchen_tickets (tenant_id, restaurant_id, station, ticket_no, label, training,
                                   open_order_id, receipt_id, created_by, lines)
      VALUES (${ticket.tenantId}, ${ticket.restaurantId}, ${station}, ${next}, ${ticket.label},
              ${ticket.training}, ${ticket.openOrderId ?? null}, ${ticket.receiptId ?? null},
              ${ticket.createdBy}, ${tx.json(stationLines as never)})`;
  }
  return byStation.size;
}
