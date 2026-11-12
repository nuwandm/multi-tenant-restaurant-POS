/** A Swedish organisation number as 10 digits, Luhn-valid. Never used as a key. */
export type OrgNumber = string & { readonly __brand: 'OrgNumber' };

/** Luhn check on exactly 10 digits, weights 2,1,2,1… from the left. Mirrors the SQL check in the schema. */
export function isValidOrgNumber(value: string): value is OrgNumber {
  if (!/^\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const product = Number(value[i]) * (i % 2 === 0 ? 2 : 1);
    sum += Math.floor(product / 10) + (product % 10);
  }
  return sum % 10 === 0;
}

/** Accepts "NNNNNN-NNNN", plain digits, or the 12-digit form with the "16" prefix. */
export function parseOrgNumber(input: string): OrgNumber {
  let digits = input.trim().replace('-', '');
  if (digits.length === 12 && digits.startsWith('16')) digits = digits.slice(2);
  if (!isValidOrgNumber(digits)) {
    throw new RangeError(`Not a valid Swedish organisation number: "${input}"`);
  }
  return digits;
}
