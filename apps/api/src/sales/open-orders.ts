import type { Sql, TransactionSql } from 'postgres';
import type { StaffSession } from '../auth/session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { createKitchenTickets, priceLines, type LineRequest, type PricedLine } from './pricing';

/** A line on an open order. sentQuantity of quantity has gone to the kitchen already. */
export interface OrderLine extends PricedLine {
  sentQuantity: number;
}

export interface OpenOrder {
  id: string;
  tableId: string | null;
  tableName: string | null;
  lines: OrderLine[];
  orderDiscountOre: number;
  totalOre: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}

interface OrderRow {
  id: string;
  table_id: string | null;
  table_name: string | null;
  lines: OrderLine[];
  order_discount_ore: number;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by_name: string;
  restaurant_id: string;
  status: string;
}

export const orderTotal = (lines: OrderLine[], orderDiscountOre: number) =>
  lines.reduce((sum, l) => sum + l.quantity * l.unitPriceOre - (l.discountOre ?? 0), 0) -
  orderDiscountOre;

const toOrder = (r: OrderRow): OpenOrder => ({
  id: r.id,
  tableId: r.table_id,
  tableName: r.table_name,
  lines: r.lines,
  orderDiscountOre: r.order_discount_ore,
  totalOre: orderTotal(r.lines, r.order_discount_ore),
  version: r.version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: r.created_by_name,
});

/** Lines with the same item and options merge; already-sent quantities are kept. */
function mergeLines(priced: PricedLine[], previous: OrderLine[] = []): OrderLine[] {
  const merged = new Map<string, OrderLine>();
  for (const p of priced) {
    const existing = merged.get(p.key);
    if (existing) {
      existing.quantity += p.quantity;
      existing.discountOre = ((existing.discountOre ?? 0) + (p.discountOre ?? 0)) as never;
    } else {
      merged.set(p.key, { ...p, sentQuantity: 0 });
    }
  }
  for (const line of merged.values()) {
    const before = previous.find((p) => p.key === line.key);
    line.sentQuantity = Math.min(before?.sentQuantity ?? 0, line.quantity);
  }
  return [...merged.values()];
}

function checkTotal(lines: OrderLine[], orderDiscountOre: number) {
  for (const l of lines) {
    if ((l.discountOre ?? 0) > l.quantity * l.unitPriceOre) {
      throw new HttpError(400, 'invalid_discount', `Discount on ${l.name} is larger than the line`);
    }
  }
  if (orderTotal(lines, orderDiscountOre) < 0) {
    throw new HttpError(400, 'invalid_discount', 'The order discount is larger than the order');
  }
}

async function restaurantOf(tx: TransactionSql, registerId: string): Promise<string> {
  const [row] = await tx<{ restaurant_id: string }[]>`
    SELECT restaurant_id FROM cash_registers WHERE id = ${registerId}`;
  if (!row) throw new HttpError(404, 'register_not_found', 'Register not found');
  return row.restaurant_id;
}

async function loadOrder(tx: TransactionSql, id: string, lock = false): Promise<OrderRow | null> {
  const rows = lock
    ? await tx<OrderRow[]>`
        SELECT o.*, t.name AS table_name, u.display_name AS created_by_name
        FROM open_orders o
        LEFT JOIN dining_tables t ON t.id = o.table_id
        JOIN users u ON u.id = o.created_by
        WHERE o.id = ${id} FOR UPDATE OF o`
    : await tx<OrderRow[]>`
        SELECT o.*, t.name AS table_name, u.display_name AS created_by_name
        FROM open_orders o
        LEFT JOIN dining_tables t ON t.id = o.table_id
        JOIN users u ON u.id = o.created_by
        WHERE o.id = ${id}`;
  return rows[0] ?? null;
}

async function openOrderFor(
  tx: TransactionSql,
  staff: StaffSession,
  orderId: string,
): Promise<OrderRow & { restaurant: string }> {
  const restaurant = await restaurantOf(tx, staff.registerId);
  const order = await loadOrder(tx, orderId, true);
  if (!order || order.restaurant_id !== restaurant) {
    throw new HttpError(404, 'order_not_found', 'Order not found');
  }
  if (order.status !== 'open')
    throw new HttpError(409, 'order_closed', 'This order is already closed');
  return { ...order, restaurant };
}

export async function listOpenOrders(sql: Sql, staff: StaffSession): Promise<OpenOrder[]> {
  return withTenant(sql, staff.tenantId, async (tx) => {
    const restaurant = await restaurantOf(tx, staff.registerId);
    const rows = await tx<OrderRow[]>`
      SELECT o.*, t.name AS table_name, u.display_name AS created_by_name
      FROM open_orders o
      LEFT JOIN dining_tables t ON t.id = o.table_id
      JOIN users u ON u.id = o.created_by
      WHERE o.restaurant_id = ${restaurant} AND o.status = 'open'
      ORDER BY t.sort_order NULLS LAST, t.name, o.created_at`;
    return rows.map(toOrder);
  });
}

export async function createOpenOrder(
  sql: Sql,
  staff: StaffSession,
  body: { tableId: string | null; lines: LineRequest[]; orderDiscountOre?: number },
): Promise<OpenOrder> {
  return withTenant(sql, staff.tenantId, async (tx) => {
    const restaurant = await restaurantOf(tx, staff.registerId);
    if (body.tableId) {
      const [table] = await tx`
        SELECT 1 FROM dining_tables
        WHERE id = ${body.tableId} AND restaurant_id = ${restaurant} AND active`;
      if (!table) throw new HttpError(404, 'table_not_found', 'Table not found');
    }
    const lines = mergeLines(await priceLines(tx, restaurant, body.lines));
    const discount = body.orderDiscountOre ?? 0;
    checkTotal(lines, discount);
    try {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO open_orders (tenant_id, restaurant_id, table_id, created_by, lines, order_discount_ore)
        VALUES (${staff.tenantId}, ${restaurant}, ${body.tableId}, ${staff.userId},
                ${tx.json(lines as never)}, ${discount})
        RETURNING id`;
      return toOrder((await loadOrder(tx, row!.id))!);
    } catch (err) {
      if ((err as { constraint_name?: string }).constraint_name === 'open_orders_one_per_table') {
        throw new HttpError(409, 'table_busy', 'This table already has an open order');
      }
      throw err;
    }
  });
}

/** Saves the order's lines. version must match, so two tills can't overwrite each other. */
export async function updateOpenOrder(
  sql: Sql,
  staff: StaffSession,
  orderId: string,
  body: { lines: LineRequest[]; orderDiscountOre?: number; version: number },
): Promise<OpenOrder> {
  return withTenant(sql, staff.tenantId, async (tx) => {
    const order = await openOrderFor(tx, staff, orderId);
    if (order.version !== body.version) {
      throw new HttpError(
        409,
        'order_changed',
        'Someone else changed this order. It has been reloaded.',
      );
    }
    const lines = mergeLines(await priceLines(tx, order.restaurant, body.lines), order.lines);
    const discount = body.orderDiscountOre ?? 0;
    checkTotal(lines, discount);
    await tx`
      UPDATE open_orders
      SET lines = ${tx.json(lines as never)}, order_discount_ore = ${discount},
          version = version + 1, updated_at = now()
      WHERE id = ${orderId}`;
    return toOrder((await loadOrder(tx, orderId))!);
  });
}

/** Sends everything not yet sent to the kitchen and bar. */
export async function sendOpenOrder(sql: Sql, staff: StaffSession, orderId: string) {
  return withTenant(sql, staff.tenantId, async (tx) => {
    const order = await openOrderFor(tx, staff, orderId);
    const tickets = await createKitchenTickets(
      tx,
      {
        tenantId: staff.tenantId,
        restaurantId: order.restaurant,
        createdBy: staff.userId,
        label: order.table_name ?? 'Order',
        training: false,
        openOrderId: orderId,
      },
      order.lines.map((l) => ({ ...l, quantity: l.quantity - l.sentQuantity })),
    );
    const lines = order.lines.map((l) => ({ ...l, sentQuantity: l.quantity }));
    await tx`
      UPDATE open_orders SET lines = ${tx.json(lines as never)}, version = version + 1, updated_at = now()
      WHERE id = ${orderId}`;
    return { tickets, order: toOrder((await loadOrder(tx, orderId))!) };
  });
}

/** Cancels an order. Once something has gone to the kitchen, only a manager may cancel it. */
export async function cancelOpenOrder(sql: Sql, staff: StaffSession, orderId: string) {
  return withTenant(sql, staff.tenantId, async (tx) => {
    const order = await openOrderFor(tx, staff, orderId);
    const sent = order.lines.some((l) => l.sentQuantity > 0);
    if (sent && staff.role === 'cashier') {
      throw new HttpError(
        403,
        'forbidden',
        'Only a manager can cancel an order that went to the kitchen',
      );
    }
    await tx`
      UPDATE open_orders SET status = 'cancelled', closed_at = now(), version = version + 1
      WHERE id = ${orderId}`;
  });
}

/**
 * Takes sold lines off an open order inside the sale's transaction. Returns what still has to be
 * sent to the kitchen (sold but never sent) and the order's label for the ticket.
 */
export async function consumeOpenOrder(
  tx: TransactionSql,
  staff: StaffSession,
  orderId: string,
  sold: PricedLine[],
): Promise<{ label: string; unsent: (PricedLine & { quantity: number })[] }> {
  const order = await openOrderFor(tx, staff, orderId);
  const lines = order.lines.map((l) => ({ ...l }));
  const unsent: (PricedLine & { quantity: number })[] = [];
  for (const s of sold) {
    const line = lines.find((l) => l.key === s.key);
    if (!line || line.quantity < s.quantity) {
      throw new HttpError(409, 'order_changed', `${s.name} is not on the order in that quantity`);
    }
    const fromUnsent = Math.max(0, s.quantity - line.sentQuantity);
    if (fromUnsent > 0) unsent.push({ ...s, quantity: fromUnsent });
    line.sentQuantity = Math.max(0, line.sentQuantity - s.quantity);
    line.quantity -= s.quantity;
    if (line.discountOre) {
      line.discountOre = Math.min(line.discountOre, line.quantity * line.unitPriceOre) as never;
    }
  }
  const remaining = lines.filter((l) => l.quantity > 0);
  await tx`
    UPDATE open_orders
    SET lines = ${tx.json(remaining as never)},
        order_discount_ore = ${remaining.length === 0 ? 0 : order.order_discount_ore},
        status = ${remaining.length === 0 ? 'paid' : 'open'},
        closed_at = ${remaining.length === 0 ? new Date() : null},
        version = version + 1, updated_at = now()
    WHERE id = ${orderId}`;
  return { label: order.table_name ?? 'Order', unsent };
}
