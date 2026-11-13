import {
  buildJournalExport,
  JournalExportError,
  type ExportEvent,
  type ExportReceipt,
  type ExportReportTotals,
  type PaymentMethod,
  type VatRate,
} from '@pos/domain';
import type { Sql, TransactionSql } from 'postgres';
import { audit, type AdminContext } from '../admin/admin-session';
import { withTenant } from '../db/tenant';
import { HttpError } from '../errors';
import { loadReceipts } from '../sales/load-receipts';
import { PRODUCT } from './product';
import { journalSchemaErrors } from './validate';

export interface JournalExportQuery {
  restaurantId: string;
  /** All of the restaurant's registers when left out. */
  registerIds?: string[];
  /** Swedish dates, both included. */
  from: string;
  to: string;
}

interface JournalRow {
  register_id: string;
  seq: number;
  event_type: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
}

interface ZRow {
  id: string;
  register_id: string;
  z_number: number;
  period_to: Date;
  sale_count: number;
  sales_total_ore: number;
  return_count: number;
  return_total_ore: number;
  totals_by_vat: { vatRate: VatRate; vatOre: number }[];
  totals_by_payment: Partial<Record<PaymentMethod, number>>;
  copy_count: number;
  copy_total_ore: number;
  training_count: number;
  training_total_ore: number;
  drawer_open_count: number;
  discount_total_ore: number;
  items_sold_count: number;
  float_ore: number;
  reducing_count: number;
  reducing_total_ore: number;
  unfinished_count: number;
  unfinished_total_ore: number;
  grand_sales_ore: number;
  grand_returns_ore: number;
  grand_total_ore: number;
}

const zTotals = (z: ZRow): ExportReportTotals => ({
  totalSalesOre: z.sales_total_ore,
  vatTotals: z.totals_by_vat.map((v) => ({ vatRate: v.vatRate, vatOre: v.vatOre })),
  floatOre: z.float_ore,
  itemsSoldCount: z.items_sold_count,
  receiptCount: z.sale_count,
  drawerOpenCount: z.drawer_open_count,
  copyCount: z.copy_count,
  copyTotalOre: z.copy_total_ore,
  trainingCount: z.training_count,
  trainingTotalOre: z.training_total_ore,
  payments: Object.entries(z.totals_by_payment).map(([method, amountOre]) => ({
    method: method as PaymentMethod,
    amountOre: amountOre ?? 0,
  })),
  returnCount: z.return_count,
  returnTotalOre: z.return_total_ore,
  discountTotalOre: z.discount_total_ore,
  reducingCount: z.reducing_count,
  reducingTotalOre: z.reducing_total_ore,
  unfinishedCount: z.unfinished_count,
  unfinishedTotalOre: z.unfinished_total_ore,
  grandSalesOre: z.grand_sales_ore,
  grandReturnsOre: z.grand_returns_ore,
  grandNetOre: z.grand_total_ore,
});

/**
 * The journal of one restaurant's registers for a period, as the XML file SKVFS 2021:16
 * requires (4 kap. 10 § SKVFS 2014:9: per register, for any period, from one or several
 * registers). The file is checked against Skatteverket's schema before it is handed out.
 */
export async function exportJournal(
  sql: Sql,
  ctx: AdminContext,
  query: JournalExportQuery,
): Promise<{ xml: string; fileName: string }> {
  if (query.from > query.to) {
    throw new HttpError(400, 'invalid_range', 'The start date is after the end date');
  }
  const xml = await withTenant(sql, ctx.tenantId, async (tx) => {
    const [place] = await tx<{ name: string; address: string | null }[]>`
      SELECT name, address FROM restaurants WHERE id = ${query.restaurantId}`;
    if (!place) throw new HttpError(404, 'restaurant_not_found', 'Restaurant not found');
    if (!place.address?.trim()) {
      throw new HttpError(409, 'restaurant_address_missing', 'Add the restaurant address first');
    }
    const [company] = await tx<{ legal_name: string; org_number: string }[]>`
      SELECT legal_name, org_number FROM tenants`;

    // Only registers enrolled with the control system have ever registered anything.
    const registers = await tx<
      {
        id: string;
        designation: string;
        manufacturing_number: string;
        control_system_serial: string;
      }[]
    >`
      SELECT id, designation, manufacturing_number, control_system_serial FROM cash_registers
      WHERE restaurant_id = ${query.restaurantId} AND control_system_serial IS NOT NULL
        AND (${query.registerIds ?? null}::uuid[] IS NULL OR id = ANY(${query.registerIds ?? null}::uuid[]))
      ORDER BY designation`;
    if (registers.length === 0) {
      throw new HttpError(404, 'no_registers', 'No registers to export');
    }

    const [period] = await tx<{ from_ts: Date; to_ts: Date }[]>`
      SELECT (${query.from}::date)::timestamp AT TIME ZONE 'Europe/Stockholm' AS from_ts,
             ((${query.to}::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm') AS to_ts`;
    const { from_ts: fromTs, to_ts: toTs } = period!;
    const ids = registers.map((r) => r.id);

    const journal = await tx<JournalRow[]>`
      SELECT register_id, seq, event_type, occurred_at, payload FROM journal_events
      WHERE register_id IN ${tx(ids)} AND occurred_at >= ${fromTs} AND occurred_at < ${toTs}
      ORDER BY occurred_at, register_id, seq`;
    if (journal.length === 0) {
      throw new HttpError(404, 'journal_empty', 'Nothing was registered in this period');
    }

    const events = await toEvents(tx, journal, registers, place.address);
    await audit(tx, ctx, 'journal.export', query.restaurantId, {
      registers: registers.map((r) => r.designation),
      from: query.from,
      to: query.to,
    });

    try {
      return buildJournalExport({
        exportedAt: new Date(),
        exportedBy: ctx.displayName,
        exportedFrom: 'Backoffice',
        // The last second of the last day, as the period the user chose.
        period: { from: fromTs, to: new Date(toTs.getTime() - 1000) },
        company: {
          legalName: company!.legal_name,
          orgNumber: company!.org_number,
          businessName: place.name,
          address: place.address,
        },
        product: PRODUCT,
        registers: registers.map((r) => ({
          designation: r.designation,
          manufacturingNumber: r.manufacturing_number,
          controlSystemSerial: r.control_system_serial,
        })),
        events,
      });
    } catch (err) {
      if (err instanceof JournalExportError) {
        throw new HttpError(409, 'journal_export_failed', err.message);
      }
      throw err;
    }
  });

  // Never hand out a file Skatteverket's schema would reject (3 kap. 2 § SKVFS 2021:16).
  const errors = await journalSchemaErrors(xml);
  if (errors.length > 0) {
    throw new HttpError(
      500,
      'journal_export_invalid',
      `The export failed validation: ${errors[0]}`,
    );
  }
  const names = query.registerIds ? 'registers' : 'all';
  return { xml, fileName: `journal-${names}-${query.from}-${query.to}.xml` };
}

/** Turns journal rows into export events, loading the receipts and reports they point to. */
async function toEvents(
  tx: TransactionSql,
  journal: JournalRow[],
  registers: { id: string; designation: string }[],
  address: string,
): Promise<ExportEvent[]> {
  const designation = new Map(registers.map((r) => [r.id, r.designation]));

  const receiptIds = journal
    .filter((e) => e.event_type === 'receipt')
    .map((e) => e.payload.receiptId as string);
  const receipts = new Map((await loadReceipts(tx, receiptIds)).map((r) => [r.id, r]));
  const originalIds = [...receipts.values()]
    .map((r) => r.originalReceiptId)
    .filter((id): id is string => id !== null);
  const originals = new Map(
    (originalIds.length === 0
      ? []
      : await tx<{ id: string; receipt_number: number; created_at: Date; control_code: string }[]>`
          SELECT id, receipt_number, created_at, control_code FROM receipts
          WHERE id IN ${tx(originalIds)}`
    ).map((r) => [r.id, r]),
  );

  // A receipt belongs to the first Z report that closed a period after it was made.
  const zReports = await tx<ZRow[]>`
    SELECT * FROM z_reports WHERE register_id IN ${tx(registers.map((r) => r.id))}
    ORDER BY register_id, z_number`;
  const zNumberFor = (registerId: string, at: Date) => {
    const own = zReports.filter((z) => z.register_id === registerId);
    const closing = own.find((z) => z.period_to >= at);
    return closing ? closing.z_number : (own.at(-1)?.z_number ?? 0) + 1;
  };

  const userIds = journal
    .map((e) => (e.payload.takenBy ?? e.payload.userId) as string | undefined)
    .filter((id): id is string => typeof id === 'string');
  const users = new Map(
    (userIds.length === 0
      ? []
      : await tx<{ id: string; display_name: string }[]>`
          SELECT id, display_name FROM users WHERE id IN ${tx(userIds)}`
    ).map((u) => [u.id, u.display_name]),
  );

  const events: ExportEvent[] = [];
  for (const e of journal) {
    const base = { designation: designation.get(e.register_id)!, registeredAt: e.occurred_at };
    const p = e.payload;
    switch (e.event_type) {
      case 'receipt': {
        const r = receipts.get(p.receiptId as string);
        if (!r) continue;
        const original = r.originalReceiptId ? originals.get(r.originalReceiptId) : undefined;
        const receipt: ExportReceipt = {
          kind: r.kind,
          number: r.receiptNumber,
          createdAt: r.createdAt,
          seller: {
            legalName: r.seller.legalName,
            orgNumber: r.seller.orgNumber,
            address: r.seller.address ?? address,
          },
          lines: r.lines.map((l) => ({
            name: l.name,
            ...(l.options && { options: l.options }),
            quantity: l.quantity,
            unitPriceOre: l.unitPriceOre,
            discountOre: l.discountOre,
            lineTotalOre: l.lineTotalOre,
            vatRate: l.vatRate,
          })),
          totalOre: r.totalOre,
          vatTotals: r.vatTotals.map((v) => ({ vatRate: v.vatRate, vatOre: v.vatOre })),
          payments: r.payments.map((x) => ({ method: x.method, amountOre: x.amountOre })),
          zNumber: zNumberFor(e.register_id, r.createdAt),
          controlCode: r.controlCode,
          ...(original && {
            original: {
              number: original.receipt_number,
              createdAt: original.created_at,
              controlCode: original.control_code,
            },
          }),
        };
        events.push({
          ...base,
          ...(r.cashier && { user: r.cashier.displayName }),
          type: 'receipt',
          receipt,
        });
        break;
      }
      case 'z_report': {
        const z = zReports.find((x) => x.id === p.zReportId);
        if (!z) continue;
        const user = users.get(p.takenBy as string);
        events.push({
          ...base,
          ...(user && { user }),
          type: 'report',
          report: { type: 'z', zNumber: z.z_number, createdAt: e.occurred_at, totals: zTotals(z) },
        });
        break;
      }
      case 'x_report': {
        // X reports from before their totals were journaled exist only in development data.
        if (!p.totals) continue;
        const user = users.get(p.takenBy as string);
        events.push({
          ...base,
          ...(user && { user }),
          type: 'report',
          report: {
            type: 'x',
            createdAt: e.occurred_at,
            totals: p.totals as ExportReportTotals,
          },
        });
        break;
      }
      case 'login':
      case 'logout': {
        const user = (p.displayName as string | undefined) ?? users.get(p.userId as string);
        events.push({ ...base, ...(user && { user }), type: e.event_type });
        break;
      }
      case 'training_mode': {
        const user = p.displayName as string | undefined;
        events.push({ ...base, ...(user && { user }), type: 'training', on: p.on === true });
        break;
      }
    }
  }
  return events;
}
