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

## Journal export (SKVFS 2021:16), as built

Sources: Skatteverket's schema package in `xml-schema/` (instance schema dated 2021-12-08, from Skatteverket's "Schemalager (XML)" page), and the texts of SKVFS 2021:16 and SKVFS 2014:9 as amended by 2021:17. The PDFs are still to be added here.

- **What is exported.** 3 kap. 3 § SKVFS 2021:16: everything the register registered under chapters 4–36, nothing else. We register receipts (all kinds), X and Z reports, logins, logouts and switches to and from training mode. Every file is checked against the schema before it is handed out (3 kap. 2 §).
- **Not yet registered (Phase B):** items registered, changed or deleted before payment (6–8 kap.), clear (16 kap.), table orders as parking (9–14 kap.), drawer openings (15 kap.), start/stop of the register (27–29 kap.). Open question for the accountant: does 4 kap. 10 § SKVFS 2014:9 ("försäljning och annan löpande användning") require these for a system like ours?
- **One export per restaurant.** `InformationOmForetaget` has one `DenAdressDarForsaljningSker`, so an export covers one restaurant's registers (one, several or all of them).
- **Total försäljningssumma** on X/Z: the sum of sales, returns not included; returns are their own item (7 kap. 2 § e, 3 § f SKVFS 2014:9: "summerade försäljningsbelopp").
- **Item type.** Every item is exported as `VARA` (goods), and counted as goods sold on Z reports. Check with the accountant whether restaurant meals should be `TJANST` (services).
- **Item names** are cut to 72 characters (the schema's limit) and include the chosen options, e.g. "Margherita (Large, Extra cheese)".
- **Line VAT** on each sold item is extracted from the line total; VAT per rate on the receipt is extracted once per rate. The two can differ by an öre.
- **Time** is Swedish local time without a zone, as the schema's type requires.
- **Z number on receipts** is the Z report whose period closed the receipt, or the next one if it is not closed yet.
- **Växelkassa** is 0: the till keeps no cash float yet. **Other registrations that reduced sales** are 0 until deleted items are registered. **Unfinished sales** are the register's open table orders when the report is taken.
- **The receipt shows the seller as printed.** Name, org number and address are stored on each receipt (7 kap. 1 § a–b SKVFS 2014:9), so later changes don't alter old receipts. Receipts from before this change use current values.
- **Register and control system numbers.** Each register gets a manufacturing number (`RP-…`); the control system's 17-character number comes from the provider when the register is enrolled. Model, program and version (`apps/api/src/journal/product.ts`) are placeholders until the manufacturer declaration is written.
- **Control codes** must be 59 characters in the export. The fake control system produces codes of that length; receipts made with the old fake codes cannot be exported.
