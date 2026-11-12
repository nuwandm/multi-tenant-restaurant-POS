# Compliance notes

Our interpretation of the rules, with open questions. Each entry should cite a section once the texts are in this folder.

## Open questions

- **Receipt series per kind.** The schema keeps one gapless series per register and receipt kind (`receipt:sale`, `receipt:return`, `receipt:copy`, `receipt:training`, `receipt:proforma`). Check SKVFS 2014:9 (as amended by 2021:17): must returns share the sales series? Do copies and training receipts need their own series? If returns must share, Phase 3 maps `return` to the `receipt:sale` sequence and the unique key changes. No schema rewrite needed.
- **Z-report fields.** `aggregateZReport` in packages/domain produces sales, returns and net totals, VAT per rate, payments per method, cash rounding, counts and totals for copies, training and proforma receipts, drawer openings, and running grand totals (sales, returns, net). Check this list against the Z-report section of SKVFS 2014:9 as amended by 2021:17. Migration 0003 stores every one of these totals in `z_reports`.
- **Drawer openings.** Z reports show 0 drawer openings because there is no cash drawer integration yet. Required on X/Z reports, so it must be recorded once a drawer is connected.
- **Who may take reports.** Z reports and returns need a manager or owner login; cashiers can sell, print copies and take X reports. Check with the accountant whether X reports should be restricted too.
- **Copies.** A copy is signed and numbered in its own series and shows the original's payments, but stores no payments, so payment totals only count real money. Confirm that the copy should carry its own control code.
- **Cash rounding.** Only the cash part of a payment is rounded to whole kronor (0–49 öre down, 50–99 öre up). The rounding is stored per receipt and totalled on the Z report. Confirm how it should be shown on the receipt.
- **Retried requests.** Solved: the till sends an `Idempotency-Key` per payment attempt and reuses it when retrying, so a retry returns the receipt already made instead of a second one.
- **Food VAT in 2026–2027.** Confirm with the accountant which rate applies to restaurant food and takeaway during the temporary food VAT reduction before Phase 2 makes VAT rates date-effective.
