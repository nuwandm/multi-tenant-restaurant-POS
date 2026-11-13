import { ore } from './money';
import type { PaymentMethod, ReceiptKind } from './receipt';
import { vatFromGross, type VatRate } from './vat';

/**
 * Export of the journal memory as XML, in the format of SKVFS 2021:16, valid against
 * Skatteverket's schema "ExportAvDataFranJournalminneEnligtSKVFS202116-2021-12-08.xsd"
 * (docs/compliance/xml-schema). Element order follows the schema's sequences exactly.
 *
 * Only what the register has registered is exported (3 kap. 3 § SKVFS 2021:16): receipts,
 * X and Z reports, logins, logouts and switches between training and normal mode.
 */

export class JournalExportError extends Error {}

export interface ExportLine {
  name: string;
  options?: string;
  /** Negative on returns. */
  quantity: number;
  unitPriceOre: number;
  /** Discount on the line, ≥ 0; its sign follows the quantity. */
  discountOre: number;
  lineTotalOre: number;
  vatRate: VatRate;
}

export interface ExportSeller {
  legalName: string;
  /** 10 digits, or 12 for a sole trader's personnummer; no dash. */
  orgNumber: string;
  address: string;
}

export interface ExportReceipt {
  kind: ReceiptKind;
  number: number;
  createdAt: Date;
  /** As printed on the receipt when it was made. */
  seller: ExportSeller;
  lines: ExportLine[];
  totalOre: number;
  vatTotals: { vatRate: VatRate; vatOre: number }[];
  payments: { method: PaymentMethod; amountOre: number }[];
  /** The Z report period the receipt belongs to. */
  zNumber: number;
  controlCode: string;
  /** Returns and copies: the receipt they refer to. */
  original?: { number: number; createdAt: Date; controlCode: string };
}

export interface ExportReportTotals {
  totalSalesOre: number;
  vatTotals: { vatRate: VatRate; vatOre: number }[];
  /** Växelkassa. */
  floatOre: number;
  /** Antal sålda varor: every item counts as goods. */
  itemsSoldCount: number;
  receiptCount: number;
  drawerOpenCount: number;
  copyCount: number;
  copyTotalOre: number;
  trainingCount: number;
  trainingTotalOre: number;
  payments: { method: PaymentMethod; amountOre: number }[];
  returnCount: number;
  returnTotalOre: number;
  discountTotalOre: number;
  /** Other registrations that reduced the day's sales, e.g. deleted items. */
  reducingCount: number;
  reducingTotalOre: number;
  /** Sales started but not finished, e.g. open table orders. */
  unfinishedCount: number;
  unfinishedTotalOre: number;
  grandSalesOre: number;
  grandReturnsOre: number;
  grandNetOre: number;
}

export interface ExportReport {
  type: 'x' | 'z';
  createdAt: Date;
  zNumber?: number;
  totals: ExportReportTotals;
}

export type ExportEvent = {
  designation: string;
  registeredAt: Date;
  /** The logged-in user, if any. */
  user?: string;
} & (
  | { type: 'receipt'; receipt: ExportReceipt }
  | { type: 'report'; report: ExportReport }
  | { type: 'login' }
  | { type: 'logout' }
  | { type: 'training'; on: boolean }
);

export interface ExportRegister {
  designation: string;
  /** Tillverkningsnummer för kassaregistret. */
  manufacturingNumber: string;
  /** Tillverkningsnummer för kontrollsystemet: 17 characters. */
  controlSystemSerial: string;
}

export interface JournalExportInput {
  exportedAt: Date;
  exportedBy?: string;
  /** Where the export is made from (a register designation or the back office). */
  exportedFrom: string;
  period: { from: Date; to: Date };
  company: ExportSeller & { businessName?: string };
  /** From the manufacturer declaration. */
  product: { model: string; program: string; version: string };
  registers: ExportRegister[];
  /** In journal order. */
  events: ExportEvent[];
}

const INSTANS = 'http://xmls.skatteverket.se/se/skatteverket/td/instans/utredningsstod/1.0';
const KOMPONENT = 'http://xmls.skatteverket.se/se/skatteverket/td/komponent/utredningsstod/1.0';

/** The schema's text fields hold at most 72 characters. */
const MAX_TEXT = 72;
const CONTROL_CODE_LENGTH = 59;
const SERIAL_LENGTH = 17;

const PAYMENT_NAMES: Record<PaymentMethod, string> = {
  cash: 'Kontant',
  card: 'Kort',
  swish: 'Swish',
  gift_card: 'Presentkort',
};

const ALL_RATES: VatRate[] = [25, 12, 6, 0];

// Values -------------------------------------------------------------------------------------

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Text within the schema's limit. Longer text is cut, never rejected. */
const text = (s: string) => [...s.trim()].slice(0, MAX_TEXT).join('');

/** Öre as kronor with two decimals: 37700 → "377.00", -8000 → "-80.00". */
const kr = (oreAmount: number) => {
  const sign = oreAmount < 0 ? '-' : '';
  const abs = Math.abs(oreAmount);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

const stockholm = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Swedish local time, the way the schema wants it: "2026-11-12T11:05:00", no zone. */
const time = (d: Date) => stockholm.format(d).replace(' ', 'T');

// Writer -------------------------------------------------------------------------------------

/** Markup made by el(); plain strings are always text and always escaped. */
type Node = string | null | undefined | false | Node[];

/**
 * An element. A string or number is its text, escaped; an array holds its child elements,
 * where empty optional parts (null, false, undefined) are left out.
 */
function el(name: string, content: string | number | Node[]): string {
  if (typeof content === 'number') return `<${name}>${content}</${name}>`;
  if (typeof content === 'string') return `<${name}>${escape(content)}</${name}>`;
  return `<${name}>${flat(content)}</${name}>`;
}

const flat = (n: Node): string => (Array.isArray(n) ? n.map(flat).join('') : n ? n : '');

/** A list element; null when empty, so an optional list is left out. */
const list = <T>(name: string, items: T[], item: (x: T) => string) =>
  items.length > 0 ? el(name, items.map(item)) : null;

// Parts --------------------------------------------------------------------------------------

function registerOf(input: JournalExportInput, designation: string): ExportRegister {
  const register = input.registers.find((r) => r.designation === designation);
  if (!register) throw new JournalExportError(`Register ${designation} is not in the export`);
  if (register.controlSystemSerial.length !== SERIAL_LENGTH) {
    throw new JournalExportError(
      `The control system serial of ${designation} must be ${SERIAL_LENGTH} characters`,
    );
  }
  return register;
}

function controlCode(value: string, what: string): string {
  if (value.length !== CONTROL_CODE_LENGTH) {
    throw new JournalExportError(
      `${what}: the control code must be ${CONTROL_CODE_LENGTH} characters, not ${value.length}`,
    );
  }
  return value;
}

const lineName = (l: ExportLine) => text(l.options ? `${l.name} (${l.options})` : l.name);

/** Sald artikel: one line of a receipt, with its own price, discount and VAT. */
function soldItem(l: ExportLine, registeredAt: Date): string {
  const gross = l.quantity * l.unitPriceOre;
  const discount = Math.sign(l.quantity) * l.discountOre;
  return el('SaldArtikel', [
    el('TypAvArtikel', 'VARA'),
    el('Artikelnamn', lineName(l)),
    el('AntalAvSaldArtikel', l.quantity),
    el('PrisPerEnhet', kr(l.unitPriceOre)),
    el('PrisPaSaldArtikel', kr(gross)),
    l.discountOre !== 0 &&
      el('RabatterPaSaldArtikelLISTA', [
        el('RabattPaSaldArtikel', [el('RabattensBelopp', kr(discount))]),
      ]),
    el('MervardesskattesatsForSaldArtikel', l.vatRate),
    el('MervardesskattPaSaldArtikel', kr(vatFromGross(ore(l.lineTotalOre), l.vatRate))),
    el('ArtikelnsRegistreringstidpunkt', time(registeredAt)),
  ]);
}

/** VAT per rate. The schema needs at least one; with nothing sold, every rate shows 0. */
function vatList(vat: { vatRate: VatRate; vatOre: number }[]): string {
  const rows = vat.length > 0 ? vat : ALL_RATES.map((vatRate) => ({ vatRate, vatOre: 0 }));
  return el(
    'MervardesskattPaOlikaSkattesatserLISTA',
    rows.map((v) =>
      el('MervardesskattPerSkattesats', [
        el('Mervardesskattesats', v.vatRate),
        el('TotaltMervardesskattebeloppPerSkattesats', kr(v.vatOre)),
      ]),
    ),
  );
}

/** Totals per means of payment. The schema needs at least one; with none, cash shows 0. */
function paymentList(payments: { method: PaymentMethod; amountOre: number }[]): string {
  const sums = new Map<PaymentMethod, number>();
  for (const p of payments) sums.set(p.method, (sums.get(p.method) ?? 0) + p.amountOre);
  const rows = sums.size > 0 ? [...sums] : ([['cash', 0]] as [PaymentMethod, number][]);
  return el(
    'TotalaForsaljningssummorPerBetalningsmedelLISTA',
    rows.map(([method, amount]) =>
      el('TotalForsaljningssummaPerBetalningsmedel', [
        el('Betalningsmedel', PAYMENT_NAMES[method]),
        el('ForsaljningssummaPerBetalningsmedel', kr(amount)),
      ]),
    ),
  );
}

const sellerHead = (s: ExportSeller) => [
  el('ForetagetsNamn', text(s.legalName)),
  el('OrganisationsnummerEllerPersonnummer', s.orgNumber.replace(/\D/g, '')),
  el('DenAdressDarForsaljningSker', text(s.address)),
];

const totalVat = (r: ExportReceipt) => r.vatTotals.reduce((sum, v) => sum + v.vatOre, 0);

/** Discount on the receipt: the sum of its lines' discounts, signed like the lines. */
const receiptDiscount = (r: ExportReceipt) =>
  r.lines.reduce((sum, l) => sum + Math.sign(l.quantity) * l.discountOre, 0);

function receiptBody(r: ExportReceipt, designation: string, register: ExportRegister): string {
  const items = el(
    'SaldaArtiklarLISTA',
    r.lines.map((l) => soldItem(l, r.createdAt)),
  );
  const discount = receiptDiscount(r);
  const sums = [
    discount !== 0 && el('TotaltRabattbeloppPaKvitto', kr(discount)),
    el('TotaltForsaljningsbeloppISvenskaKronor', kr(r.totalOre)),
  ];
  const serial = el('TillverkningsnummerForKontrollsystemet', register.controlSystemSerial);
  const what = `${r.kind} ${r.number} on ${designation}`;

  switch (r.kind) {
    case 'sale':
      return el('Kassakvitto', [
        sellerHead(r.seller),
        el('DatumOchKlockslagNarKvittoFramstalls', time(r.createdAt)),
        el('LopnummerForKassakvitto', String(r.number)),
        el('Kassabeteckning', text(designation)),
        items,
        sums,
        el('MervardesskattPaForsaljningsbeloppet', kr(totalVat(r))),
        paymentList(r.payments),
        vatList(r.vatTotals),
        el('LopnummerForZDagrapportPaKvitto', String(r.zNumber)),
        serial,
        el('Kontrollkod', controlCode(r.controlCode, what)),
      ]);
    case 'return':
      return el('Returkvitto', [
        sellerHead(r.seller),
        el('DatumOchKlockslagNarReturkvittoFramstalls', time(r.createdAt)),
        el('LopnummerForKassakvitto', String(r.number)),
        r.original && el('LopnummerForUrsprungligtKassakvitto', String(r.original.number)),
        el('Kassabeteckning', text(designation)),
        items,
        sums,
        el('MervardesskattPaForsaljningsbeloppet', kr(totalVat(r))),
        paymentList(r.payments),
        vatList(r.vatTotals),
        el('LopnummerForZDagrapportPaKvitto', String(r.zNumber)),
        serial,
        el('Kontrollkod', controlCode(r.controlCode, what)),
      ]);
    case 'copy': {
      if (!r.original) throw new JournalExportError(`${what}: a copy needs its original`);
      return el('KopiaAvKassakvitto', [
        sellerHead(r.seller),
        el('DatumOchKlockslagNarKvittoFramstalls', time(r.createdAt)),
        el('DatumOchKlockslagNarOriginalkvittoFramstalldes', time(r.original.createdAt)),
        el('LopnummerForKvittokopia', String(r.number)),
        el('LopnummerPaOriginalkvitto', String(r.original.number)),
        el('Kassabeteckning', text(designation)),
        items,
        sums,
        el('MervardesskattPaForsaljningsbeloppet', kr(totalVat(r))),
        paymentList(r.payments),
        vatList(r.vatTotals),
        el('KontrollkodPaKopiaAvKassakvitto', controlCode(r.controlCode, what)),
        el('LopnummerForZDagrapportPaKvitto', String(r.zNumber)),
        serial,
        el(
          'KontrollkodForKvittotSomKopianAvser',
          controlCode(r.original.controlCode, `original of ${what}`),
        ),
      ]);
    }
    case 'proforma':
      return el('ProFormaKvitto', [
        sellerHead(r.seller),
        el('DatumOchKlockslagNarProFormaKvittoFramstalls', time(r.createdAt)),
        el('Kassabeteckning', text(designation)),
        items,
        sums,
        el('MervardesskattPaForsaljningsbeloppet', kr(totalVat(r))),
        vatList(r.vatTotals),
        serial,
      ]);
    case 'training':
      return el('Ovningskvitto', [
        sellerHead(r.seller),
        el('DatumOchKlockslagNarKvittoFramstalls', time(r.createdAt)),
        el('LopnummerForOvningskvitto', String(r.number)),
        el('Kassabeteckning', text(designation)),
        items,
        sums,
        el('MervardesskattPaForsaljningsbeloppet', kr(totalVat(r))),
        paymentList(r.payments),
        vatList(r.vatTotals),
        el('LopnummerForZDagrapportPaKvitto', String(r.zNumber)),
        serial,
      ]);
  }
}

function reportBody(
  input: JournalExportInput,
  report: ExportReport,
  designation: string,
  register: ExportRegister,
): string {
  const t = report.totals;
  const head = [
    el('ForetagetsNamn', text(input.company.legalName)),
    el('OrganisationsnummerEllerPersonnummer', input.company.orgNumber.replace(/\D/g, '')),
    el('DatumOchKlockslagNarRapportFramstalls', time(report.createdAt)),
  ];
  const body = [
    el('TotalForsaljningssumma', kr(t.totalSalesOre)),
    vatList(t.vatTotals),
    el('VaxelkassansBeloppISvenskaKronor', kr(t.floatOre)),
    el('AntalSaldaVaror', t.itemsSoldCount),
    el('AntalKassakvitton', t.receiptCount),
    el('AntalKassaladoppningar', t.drawerOpenCount),
    el('AntalKvittokopior', t.copyCount),
    el('TotaltBeloppPaKvittokopior', kr(t.copyTotalOre)),
    el('AntalKvittonSomTagitsFramIOvningslage', t.trainingCount),
    el('TotaltBeloppIOvningslage', kr(Math.max(0, t.trainingTotalOre))),
    paymentList(t.payments),
    el('AntalReturer', t.returnCount),
    el('ReturernasBelopp', kr(t.returnTotalOre)),
    el('RabatternasBelopp', kr(t.discountTotalOre)),
    el('AntalOvrigaRegistreringarSomMinskatDagensForsaljningsbelopp', t.reducingCount),
    el(
      'TotaltBeloppAvOvrigaRegistreringarSomMinskatDagensForsaljningsbelopp',
      kr(Math.abs(t.reducingTotalOre)),
    ),
    el('AntalOavslutadeForsaljningar', t.unfinishedCount),
    el('TotaltBeloppAvOavslutadeForsaljningar', kr(Math.max(0, t.unfinishedTotalOre))),
    el('GrandTotalForsaljning', kr(Math.max(0, t.grandSalesOre))),
    el('GrandTotalRetur', kr(t.grandReturnsOre)),
    el('GrandTotalNetto', kr(t.grandNetOre)),
  ];

  if (report.type === 'x') {
    return el('XDagrapport', [head, el('Kassabeteckning', text(designation)), body]);
  }
  if (report.zNumber === undefined) throw new JournalExportError('A Z report needs its number');
  return el('ZDagrapport', [
    head,
    el('LopnummerForZDagrapport', String(report.zNumber)),
    el('Kassabeteckning', text(designation)),
    el('TillverkningsnummerForKassaregistret', register.manufacturingNumber),
    el('ModellbeteckningForKassaregistret', text(input.product.model)),
    el('ModellEllerProgramForKassaregistret', text(input.product.program)),
    el('VersionsnummerForKassaregistret', text(input.product.version)),
    body,
  ]);
}

function event(input: JournalExportInput, e: ExportEvent): string {
  const register = registerOf(input, e.designation);
  let what: string;
  switch (e.type) {
    case 'receipt':
      what = receiptBody(e.receipt, e.designation, register);
      break;
    case 'report':
      what = reportBody(input, e.report, e.designation, register);
      break;
    case 'login':
      what = el('InloggningIKassaregister', 'JA');
      break;
    case 'logout':
      what = el('UtloggningUrKassaregister', 'JA');
      break;
    case 'training':
      what = el(e.on ? 'StallaOmTillOvningslage' : 'StallaOmTillNormallage', 'JA');
      break;
  }
  return el('Handelse', [
    e.user && el('InloggadAnvandare', text(e.user)),
    el('Kassabeteckning', text(e.designation)),
    el('Registreringstidpunkt', time(e.registeredAt)),
    what,
  ]);
}

/** The complete export file, UTF-8, XML 1.0 (3 kap. 2 § SKVFS 2021:16). */
export function buildJournalExport(input: JournalExportInput): string {
  if (input.registers.length === 0) {
    throw new JournalExportError('An export needs at least one register');
  }
  const c = input.company;
  const root = 'utrein:ExportAvDataFranJournalminneEnligtSKVFS2021-16';
  const body = flat([
    input.exportedBy &&
      el('InloggadAnvandareVidExportAvDataFranJournalminnet', text(input.exportedBy)),
    el(
      'BeteckningPaDetKassaregisterSomExportAvDataFranJournalminnetSkerIfran',
      text(input.exportedFrom),
    ),
    el('TidpunktForNarExportAvDataFranJournalminnetSker', time(input.exportedAt)),
    el('ValdPeriodForExportAvDataFranJournalminne', [
      el('ValdStarttidpunktForExportAvDataFranJournalminnet', time(input.period.from)),
      el('ValdSluttidpunktForExportAvDataFranJournalminnet', time(input.period.to)),
    ]),
    el(
      'BeteckningPaValdaKassaregisterForExportAvDataFranJournalminnenLISTA',
      input.registers.map((r) =>
        el('BeteckningPaValtKassaregisterForExportAvDataFranJournalminnet', text(r.designation)),
      ),
    ),
    el('InformationOmForetaget', [
      el('OrganisationsnummerEllerPersonnummer', c.orgNumber.replace(/\D/g, '')),
      el('ForetagetsNamn', text(c.legalName)),
      c.businessName && el('NamnPaVerksamheten', text(c.businessName)),
      el('DenAdressDarForsaljningSker', text(c.address)),
    ]),
    el(
      'KassaregistersystemLISTA',
      input.registers.map((r) =>
        el('Kassaregistersystemet', [
          el('TillverkningsnummerForKassaregistret', r.manufacturingNumber),
          el('ModellbeteckningForKassaregistret', text(input.product.model)),
          el('ModellEllerProgramForKassaregistret', text(input.product.program)),
          el('VersionsnummerForKassaregistret', text(input.product.version)),
          el('Kassabeteckning', text(r.designation)),
          el(
            'TillverkningsnummerForKontrollsystemet',
            registerOf(input, r.designation).controlSystemSerial,
          ),
        ]),
      ),
    ),
    // The schema needs at least one registration; an empty period still has none to show.
    list('RegistreringLISTA', input.events, (e) => event(input, e)) ?? emptyRegistrations(input),
  ]);
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<${root} xmlns:utrein="${INSTANS}" xmlns="${KOMPONENT}">${body}</${root}>\n`
  );
}

/**
 * RegistreringLISTA needs at least one Handelse. A period with nothing registered can't be
 * exported as a valid file, so we refuse rather than invent an event.
 */
function emptyRegistrations(input: JournalExportInput): never {
  throw new JournalExportError(
    `Nothing was registered between ${time(input.period.from)} and ${time(input.period.to)}`,
  );
}
