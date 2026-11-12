import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sv } from './sv';

const srcDir = fileURLToPath(new URL('.', import.meta.url));

/** Every English UI string: t('…') literals plus the label maps translated via t(variable). */
function englishStrings(): string[] {
  const found = new Set<string>();
  const files = (readdirSync(srcDir, { recursive: true }) as string[]).filter(
    (f) => /\.tsx?$/.test(f) && !/test|sv\.ts/.test(f),
  );
  for (const file of files) {
    const source = readFileSync(join(srcDir, file), 'utf8');
    for (const m of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g))
      found.add(m[1]!.replace(/\\'/g, "'"));
    const maps = source.match(
      /(ERROR_TEXT|ROLE_LABELS|STATUS_LABELS|COMPANY_PAGES|ACTION_LABELS|VAT_OPTIONS)\b[^=]*=\s*\{[\s\S]*?\n\};/g,
    );
    for (const block of maps ?? []) {
      for (const m of block.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g))
        found.add(m[1]!.replace(/\\'/g, "'"));
    }
    for (const m of source.matchAll(/new ApiError\(\s*'((?:[^'\\]|\\.)*)'/g)) found.add(m[1]!);
  }
  return [...found].sort();
}

describe('Swedish translations', () => {
  it('cover every English UI string', () => {
    const missing = englishStrings().filter((s) => !(s in sv));
    expect(missing).toEqual([]);
  });

  it('keep the same {placeholders}', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort();
    const mismatched = Object.entries(sv).filter(
      ([en, svText]) => placeholders(en).join() !== placeholders(svText).join(),
    );
    expect(mismatched).toEqual([]);
  });
});
