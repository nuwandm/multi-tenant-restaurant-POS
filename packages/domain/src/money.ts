/** An amount in öre (1 kr = 100 öre). Always a safe integer, never a float. */
export type Ore = number & { readonly __brand: 'Ore' };

export function ore(value: number): Ore {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be an integer number of öre, got ${value}`);
  }
  return value as Ore;
}

/** Parses a kronor string such as "129", "129.5" or "129,50" without going through floats. */
export function parseKronor(input: string): Ore {
  const match = /^(-)?(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    throw new RangeError(`Not a valid kronor amount: "${input}"`);
  }
  const [, sign, kronor = '0', fraction = ''] = match;
  const value = Number(kronor) * 100 + Number(fraction.padEnd(2, '0'));
  return ore(sign ? -value : value);
}

export function addOre(...amounts: Ore[]): Ore {
  return ore(amounts.reduce<number>((sum, amount) => sum + amount, 0));
}

export function multiplyOre(amount: Ore, quantity: number): Ore {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Quantity must be an integer, got ${quantity}`);
  }
  return ore(amount * quantity);
}
