# Makes one real sale through the running API (start it first with: pnpm dev:api).
# Needs the demo data from seed-dev.sql. Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File apps/api/db/demo-sale.ps1
$tenant = 'd0000000-0000-0000-0000-000000000001'
$register = 'd0000000-0000-0000-0000-0000000000c1'

$body = @{
  kind     = 'sale'
  lines    = @(
    @{ articleId = 'd0000000-0000-0000-0000-000000000b01'; quantity = 2 },  # Pasta carbonara 149 kr
    @{ articleId = 'd0000000-0000-0000-0000-000000000b03'; quantity = 1 }   # Kaffe 34,50 kr
  )
  payments = @(@{ method = 'cash'; amountOre = 33300 })                     # 332,50 kr rounds to 333 kr
} | ConvertTo-Json -Depth 5

# Log in as Erik (cashier, PIN 0000) on the demo register.
$login = @{ registerId = $register; userId = 'd0000000-0000-0000-0000-000000000f02'; pin = '0000' } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' `
  -Headers @{ 'x-tenant-id' = $tenant } -ContentType 'application/json' -Body $login

$r = Invoke-RestMethod -Method Post -Uri "http://localhost:3000/registers/$register/receipts" `
  -Headers @{ Authorization = "Bearer $($session.token)" } -ContentType 'application/json' -Body $body

function Kr($ore) { '{0:N2} kr' -f ($ore / 100) }

"{0}  org.nr {1}" -f $r.seller.legalName, $r.seller.orgNumber
"Kassa {0}   Kvitto nr {1}   {2}" -f $r.register.designation, $r.receiptNumber, $r.createdAt
"Kassor: {0}" -f $r.cashier.displayName
'-' * 48
foreach ($l in $r.lines) { "{0,3} x {1,-24} {2,12}" -f $l.quantity, $l.name, (Kr $l.lineTotalOre) }
'-' * 48
"{0,-30} {1,12}" -f 'Totalt', (Kr $r.totalOre)
foreach ($v in $r.vatTotals) { "  Moms {0,2}%  netto {1,12}  moms {2,10}" -f $v.vatRate, (Kr $v.netOre), (Kr $v.vatOre) }
"{0,-30} {1,12}" -f 'Oresavrundning', (Kr $r.cashRoundingOre)
foreach ($p in $r.payments) { "{0,-30} {1,12}" -f "Betalt $($p.method)", (Kr $p.amountOre) }
'-' * 48
"Kontrollkod: {0}" -f $r.controlCode
