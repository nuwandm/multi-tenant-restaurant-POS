import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateXML } from 'xmllint-wasm';
import {
  buildJournalExport,
  JournalExportError,
  type ExportEvent,
  type ExportReceipt,
  type ExportReportTotals,
  type JournalExportInput,
} from './journal-export';

// Skatteverket's schema for SKVFS 2021:16, as published in its schema store (docs/compliance).
const SCHEMA_ROOT = fileURLToPath(new URL('../../../docs/compliance/xml-schema/', import.meta.url));
const schemaFile = (path: string) => ({
  fileName: path,
  contents: readFileSync(SCHEMA_ROOT + path, 'utf8'),
});
const DIR = 'xmls/komponent/utredningsstod/2021-12-08/';

async function schemaErrors(xml: string): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: 'export.xml', contents: xml }],
    schema: [
      schemaFile(
        'xmls/instans/utredningsstod/2021-12-08/ExportAvDataFranJournalminneEnligtSKVFS202116-2021-12-08.xsd',
      ),
    ],
    preload: [
      schemaFile(`${DIR}Utredningsstod-ElementAvSammansattTyp-2021-12-08-COMPONENT.xsd`),
      schemaFile(`${DIR}Utredningsstod-ElementAvEnkelTyp-2021-12-08-COMPONENT.xsd`),
      schemaFile(`${DIR}Utredningsstod-GenerellaTypdefinitioner-2021-12-08-TYPELIB.xsd`),
    ],
  });
  // Any failure counts, also one in loading the schema, so a broken setup can't pass quietly.
  return result.valid ? [] : result.errors.map((e) => e.message);
}

/** A control code of the length SKVFS 2009:2 codes have in the export. */
const code = (n: number) => `CODE${String(n).padStart(55, '0')}`;
const at = (iso: string) => new Date(iso);

const seller = {
  legalName: 'Café & Bar Åsa AB',
  orgNumber: '5561234567',
  address: 'Storgatan 1, Malmö',
};

const sale: ExportReceipt = {
  kind: 'sale',
  number: 1,
  createdAt: at('2026-11-12T10:05:00Z'),
  seller,
  lines: [
    {
      name: 'Margherita',
      options: 'Large, Extra cheese',
      quantity: 2,
      unitPriceOre: 16500,
      discountOre: 3300,
      lineTotalOre: 29700,
      vatRate: 12,
    },
    {
      name: 'Öl',
      quantity: 1,
      unitPriceOre: 8000,
      discountOre: 0,
      lineTotalOre: 8000,
      vatRate: 25,
    },
  ],
  totalOre: 37700,
  vatTotals: [
    { vatRate: 25, vatOre: 1600 },
    { vatRate: 12, vatOre: 3182 },
  ],
  payments: [
    { method: 'card', amountOre: 20000 },
    { method: 'cash', amountOre: 17700 },
  ],
  zNumber: 1,
  controlCode: code(1),
};

const returned: ExportReceipt = {
  kind: 'return',
  number: 1,
  createdAt: at('2026-11-12T11:00:00Z'),
  seller,
  lines: [
    {
      name: 'Öl',
      quantity: -1,
      unitPriceOre: 8000,
      discountOre: 0,
      lineTotalOre: -8000,
      vatRate: 25,
    },
  ],
  totalOre: -8000,
  vatTotals: [{ vatRate: 25, vatOre: -1600 }],
  payments: [{ method: 'swish', amountOre: -8000 }],
  zNumber: 1,
  controlCode: code(2),
  original: { number: 1, createdAt: sale.createdAt, controlCode: sale.controlCode },
};

const copy: ExportReceipt = {
  ...sale,
  kind: 'copy',
  number: 1,
  createdAt: at('2026-11-12T11:30:00Z'),
  controlCode: code(3),
  original: { number: 1, createdAt: sale.createdAt, controlCode: sale.controlCode },
};

const training: ExportReceipt = { ...sale, kind: 'training', number: 4, controlCode: code(4) };
const proforma: ExportReceipt = {
  ...sale,
  kind: 'proforma',
  number: 2,
  payments: [],
  controlCode: code(5),
};

const totals: ExportReportTotals = {
  totalSalesOre: 29700,
  vatTotals: [
    { vatRate: 25, vatOre: 0 },
    { vatRate: 12, vatOre: 3182 },
  ],
  floatOre: 0,
  itemsSoldCount: 2,
  receiptCount: 1,
  drawerOpenCount: 0,
  copyCount: 1,
  copyTotalOre: 37700,
  trainingCount: 1,
  trainingTotalOre: 37700,
  payments: [
    { method: 'card', amountOre: 20000 },
    { method: 'cash', amountOre: 17700 },
    { method: 'swish', amountOre: -8000 },
  ],
  returnCount: 1,
  returnTotalOre: -8000,
  discountTotalOre: 3300,
  reducingCount: 0,
  reducingTotalOre: 0,
  unfinishedCount: 2,
  unfinishedTotalOre: 45000,
  grandSalesOre: 37700,
  grandReturnsOre: -8000,
  grandNetOre: 29700,
};

const on = (designation: string, iso: string, user?: string) => ({
  designation,
  registeredAt: at(iso),
  ...(user && { user }),
});

const events: ExportEvent[] = [
  { ...on('KASSA-1', '2026-11-12T10:00:00Z', 'Anna'), type: 'login' },
  { ...on('KASSA-1', '2026-11-12T10:05:00Z', 'Anna'), type: 'receipt', receipt: sale },
  { ...on('KASSA-1', '2026-11-12T10:30:00Z', 'Anna'), type: 'training', on: true },
  { ...on('KASSA-1', '2026-11-12T10:31:00Z', 'Anna'), type: 'receipt', receipt: training },
  { ...on('KASSA-1', '2026-11-12T10:32:00Z', 'Anna'), type: 'training', on: false },
  { ...on('KASSA-1', '2026-11-12T10:40:00Z', 'Anna'), type: 'receipt', receipt: proforma },
  { ...on('KASSA-1', '2026-11-12T11:00:00Z', 'Anna'), type: 'receipt', receipt: returned },
  { ...on('KASSA-1', '2026-11-12T11:30:00Z', 'Anna'), type: 'receipt', receipt: copy },
  {
    ...on('KASSA-1', '2026-11-12T20:00:00Z', 'Anna'),
    type: 'report',
    report: { type: 'x', createdAt: at('2026-11-12T20:00:00Z'), totals },
  },
  {
    ...on('KASSA-1', '2026-11-12T21:00:00Z', 'Anna'),
    type: 'report',
    report: { type: 'z', zNumber: 1, createdAt: at('2026-11-12T21:00:00Z'), totals },
  },
  { ...on('KASSA-1', '2026-11-12T21:05:00Z', 'Anna'), type: 'logout' },
];

const input: JournalExportInput = {
  exportedAt: at('2026-11-13T08:00:00Z'),
  exportedBy: 'Anna Ägare',
  exportedFrom: 'Back office',
  period: { from: at('2026-11-11T23:00:00Z'), to: at('2026-11-12T22:59:59Z') },
  company: {
    orgNumber: '5561234567',
    legalName: seller.legalName,
    businessName: 'Café Åsa',
    address: seller.address,
  },
  product: { model: 'Restaurant POS', program: 'restaurant-pos', version: '0.1.0' },
  registers: [
    {
      designation: 'KASSA-1',
      manufacturingNumber: 'RP-0A1B2C3D4E5F',
      controlSystemSerial: 'FAKE0000000000001',
    },
  ],
  events,
};

describe('journal export (SKVFS 2021:16)', () => {
  it('is valid against Skatteverket’s XML schema', async () => {
    const xml = buildJournalExport(input);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(await schemaErrors(xml)).toEqual([]);
  });

  it('is valid for a period without any registrations', async () => {
    const empty = buildJournalExport({
      ...input,
      events: [
        {
          ...on('KASSA-1', '2026-11-12T21:00:00Z'),
          type: 'report',
          report: {
            type: 'z',
            zNumber: 2,
            createdAt: at('2026-11-12T21:00:00Z'),
            totals: {
              ...totals,
              totalSalesOre: 0,
              vatTotals: [],
              payments: [],
              receiptCount: 0,
            },
          },
        },
      ],
    });
    expect(await schemaErrors(empty)).toEqual([]);
  });

  it('writes Swedish local time without a zone, and amounts with two decimals', () => {
    const xml = buildJournalExport(input);
    // 10:05 UTC is 11:05 in Stockholm in November.
    expect(xml).toContain('<DatumOchKlockslagNarKvittoFramstalls>2026-11-12T11:05:00<');
    expect(xml).toContain('<TotaltForsaljningsbeloppISvenskaKronor>377.00<');
    expect(xml).toContain('<TotaltForsaljningsbeloppISvenskaKronor>-80.00<');
    expect(xml).toContain('<OrganisationsnummerEllerPersonnummer>5561234567<');
    expect(xml).toContain('<AntalSaldaVaror>2</AntalSaldaVaror>');
  });

  it('gives each sold item its price, discount and VAT', () => {
    const xml = buildJournalExport(input);
    const pizza = xml.slice(xml.indexOf('<SaldArtikel>'), xml.indexOf('</SaldArtikel>'));
    expect(pizza).toContain('<Artikelnamn>Margherita (Large, Extra cheese)</Artikelnamn>');
    expect(pizza).toContain('<AntalAvSaldArtikel>2</AntalAvSaldArtikel>');
    expect(pizza).toContain('<PrisPerEnhet>165.00</PrisPerEnhet>');
    expect(pizza).toContain('<PrisPaSaldArtikel>330.00</PrisPaSaldArtikel>');
    expect(pizza).toContain('<RabattensBelopp>33.00</RabattensBelopp>');
    expect(pizza).toContain(
      '<MervardesskattesatsForSaldArtikel>12</MervardesskattesatsForSaldArtikel>',
    );
    // 12 % VAT inside 297,00 kr.
    expect(pizza).toContain('<MervardesskattPaSaldArtikel>31.82</MervardesskattPaSaldArtikel>');
  });

  it('shows a return with negative amounts and the original receipt number', () => {
    const xml = buildJournalExport(input);
    const ret = xml.slice(xml.indexOf('<Returkvitto>'), xml.indexOf('</Returkvitto>'));
    expect(ret).toContain('<AntalAvSaldArtikel>-1</AntalAvSaldArtikel>');
    expect(ret).toContain('<LopnummerForUrsprungligtKassakvitto>1<');
    expect(ret).toContain('<Betalningsmedel>Swish</Betalningsmedel>');
  });

  it('ties a copy to its original and the original’s control code', () => {
    const xml = buildJournalExport(input);
    const c = xml.slice(xml.indexOf('<KopiaAvKassakvitto>'), xml.indexOf('</KopiaAvKassakvitto>'));
    expect(c).toContain(`<KontrollkodForKvittotSomKopianAvser>${code(1)}<`);
    expect(c).toContain(`<KontrollkodPaKopiaAvKassakvitto>${code(3)}<`);
    expect(c).toContain('<DatumOchKlockslagNarOriginalkvittoFramstalldes>2026-11-12T11:05:00<');
  });

  it('escapes text and keeps it within the schema’s 72 characters', async () => {
    const long = buildJournalExport({
      ...input,
      events: [
        {
          ...on('KASSA-1', '2026-11-12T10:05:00Z', 'Anna <Chef> & "Co"'),
          type: 'receipt',
          receipt: {
            ...sale,
            lines: [{ ...sale.lines[1]!, name: `Öl & ${'x'.repeat(100)}` }],
            totalOre: 8000,
          },
        },
      ],
    });
    expect(long).toContain('<InloggadAnvandare>Anna &lt;Chef&gt; &amp; &quot;Co&quot;<');
    // Text that looks like markup is still text.
    const sneaky = buildJournalExport({
      ...input,
      events: [
        { ...on('KASSA-1', '2026-11-12T10:00:00Z', '<Kontrollkod>x</Kontrollkod>'), type: 'login' },
      ],
    });
    expect(sneaky).toContain('<InloggadAnvandare>&lt;Kontrollkod&gt;x&lt;/Kontrollkod&gt;<');
    expect(await schemaErrors(long)).toEqual([]);
  });

  it('refuses control codes the schema cannot hold, rather than writing an invalid file', () => {
    const bad = { ...sale, controlCode: 'FAKE-123' };
    expect(() =>
      buildJournalExport({
        ...input,
        events: [{ ...on('KASSA-1', '2026-11-12T10:05:00Z'), type: 'receipt', receipt: bad }],
      }),
    ).toThrow(JournalExportError);
  });
});
