import { readFileSync } from 'node:fs';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

/**
 * The cash register as described in the manufacturer declaration (tillverkardeklaration,
 * 8 kap. SKVFS 2014:9): model designation, model or program, and version (4 kap. 3 och 6 §§).
 * Placeholders until the declaration is written; change them here, in one place.
 */
export const PRODUCT = {
  model: 'Restaurant POS',
  program: 'restaurant-pos',
  version,
};
