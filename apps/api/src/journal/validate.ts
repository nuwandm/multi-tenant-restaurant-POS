import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateXML } from 'xmllint-wasm';

/** Skatteverket's schema for SKVFS 2021:16, from its schema store (docs/compliance/xml-schema). */
const ROOT = fileURLToPath(new URL('../../../../docs/compliance/xml-schema/', import.meta.url));
const MAIN =
  'xmls/instans/utredningsstod/2021-12-08/ExportAvDataFranJournalminneEnligtSKVFS202116-2021-12-08.xsd';
const PARTS = [
  'Utredningsstod-ElementAvSammansattTyp-2021-12-08-COMPONENT.xsd',
  'Utredningsstod-ElementAvEnkelTyp-2021-12-08-COMPONENT.xsd',
  'Utredningsstod-GenerellaTypdefinitioner-2021-12-08-TYPELIB.xsd',
].map((name) => `xmls/komponent/utredningsstod/2021-12-08/${name}`);

type SchemaFile = { fileName: string; contents: string };
let schema: Promise<SchemaFile[]> | null = null;

const load = (fileName: string) =>
  readFile(ROOT + fileName, 'utf8').then((contents) => ({ fileName, contents }));

/**
 * Checks an export against the schema, as 3 kap. 2 § SKVFS 2021:16 requires. Returns the
 * errors; an empty list means the file is valid.
 */
export async function journalSchemaErrors(xml: string): Promise<string[]> {
  schema ??= Promise.all([MAIN, ...PARTS].map(load));
  const [main, ...parts] = await schema;
  const result = await validateXML({
    xml: [{ fileName: 'export.xml', contents: xml }],
    schema: [main!],
    preload: parts,
  });
  return result.valid ? [] : result.errors.map((e) => e.message);
}
