/** Swedish VAT rates in percent. Phase 2 makes rates date-effective. */
export const VAT_RATES = [25, 12, 6, 0] as const;

export type VatRate = (typeof VAT_RATES)[number];

export function isVatRate(value: number): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(value);
}
