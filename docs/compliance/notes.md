# Compliance notes

Our interpretation of the rules, with open questions. Each entry should cite a section once the texts are in this folder.

## Open questions

- **Receipt series per kind.** The schema keeps one gapless series per register and receipt kind (`receipt:sale`, `receipt:return`, `receipt:copy`, `receipt:training`, `receipt:proforma`). Check SKVFS 2014:9 (as amended by 2021:17): must returns share the sales series? Do copies and training receipts need their own series? If returns must share, Phase 3 maps `return` to the `receipt:sale` sequence and the unique key changes. No schema rewrite needed.
- **Food VAT in 2026–2027.** Confirm with the accountant which rate applies to restaurant food and takeaway during the temporary food VAT reduction before Phase 2 makes VAT rates date-effective.
