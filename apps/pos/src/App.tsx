import { buildReceipt, ore, type PaymentMethod } from '@pos/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createReceipt,
  getHealth,
  getMenu,
  isManager,
  newAttemptKey,
  type Article,
  type Menu,
  type Receipt,
  type Staff,
} from './api';
import { CashDialog } from './CashDialog';
import { formatKr } from './format';
import { ReceiptsDialog } from './ReceiptsDialog';
import { ReceiptView } from './ReceiptView';
import { ReportDialog } from './ReportDialog';

interface BasketLine {
  article: Article;
  quantity: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface Props {
  staff: Staff;
  companyStatus: 'pending' | 'active' | 'suspended';
  onLogout: () => void;
}

export function App({ staff, companyStatus, onLogout }: Props) {
  const manager = isManager(staff);
  // Until the company is approved the till can only train.
  const trainingOnly = companyStatus === 'pending';
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [groupIndex, setGroupIndex] = useState(0);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [training, setTraining] = useState(trainingOnly);
  const [cashOpen, setCashOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ receipt: Receipt; changeOre: number } | null>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const [report, setReport] = useState<'x' | 'z' | null>(null);

  useEffect(() => {
    getMenu()
      .then(setMenu)
      .catch((err: unknown) => setLoadError(message(err)));
  }, []);

  useEffect(() => {
    const check = () =>
      getHealth()
        .then((h) => setOnline(h.controlSystem.online))
        .catch(() => setOnline(false));
    void check();
    const timer = setInterval(check, 10_000);
    return () => clearInterval(timer);
  }, []);

  // Live totals with the same domain logic the API uses; the API recomputes from its own prices.
  const preview = useMemo(
    () =>
      basket.length === 0
        ? null
        : buildReceipt({
            kind: 'proforma',
            lines: basket.map((l) => ({
              articleId: l.article.id,
              name: l.article.name,
              quantity: l.quantity,
              unitPriceOre: ore(l.article.priceOre),
              vatRate: l.article.vatRate,
            })),
            payments: [],
          }),
    [basket],
  );

  function add(article: Article) {
    setError(null);
    setBasket((lines) =>
      lines.some((l) => l.article.id === article.id)
        ? lines.map((l) => (l.article.id === article.id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { article, quantity: 1 }],
    );
  }

  function changeQuantity(articleId: string, delta: number) {
    setBasket((lines) =>
      lines.flatMap((l) => {
        if (l.article.id !== articleId) return [l];
        const quantity = l.quantity + delta;
        return quantity > 0 ? [{ ...l, quantity }] : [];
      }),
    );
  }

  async function pay(method: PaymentMethod, amountOre: number, changeOre = 0) {
    setBusy(true);
    setError(null);
    const body = {
      kind: training ? ('training' as const) : ('sale' as const),
      lines: basket.map((l) => ({ articleId: l.article.id, quantity: l.quantity })),
      payments: [{ method, amountOre }],
    };
    // Tapping pay again for the same order after a lost connection reuses the key, so the
    // API returns the receipt it already made instead of charging twice.
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newAttemptKey() };
    }
    try {
      const receipt = await createReceipt(body, attempt.current.key);
      attempt.current = null;
      setCashOpen(false);
      setDone({ receipt, changeOre });
    } catch (err) {
      setCashOpen(false);
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function newSale() {
    // Copies and returns are made from the receipts dialog and leave an open order alone.
    if (done?.receipt.kind === 'sale' || done?.receipt.kind === 'training') setBasket([]);
    setDone(null);
  }

  if (loadError) {
    return (
      <div className="center-message">
        <h1>Kassan kunde inte startas</h1>
        <p>{loadError}</p>
        <p className="hint">
          Har du laddat demodata?{' '}
          <code>
            Get-Content apps/api/db/seed-dev.sql | docker compose exec -T postgres psql -U pos -d
            pos
          </code>
        </p>
      </div>
    );
  }
  if (!menu) return <div className="center-message">Laddar kassan…</div>;

  const group = menu.groups[groupIndex];
  const total = preview?.totalOre ?? 0;
  const canPay = basket.length > 0 && !busy && online !== false;

  return (
    <div className={`till ${training ? 'training' : ''}`}>
      {training && (
        <div className="training-banner">TRÄNINGSLÄGE – försäljning räknas inte som riktig</div>
      )}

      <header className="topbar">
        <div>
          <strong>{menu.restaurant.name}</strong>
          <span className="muted"> · {menu.register.designation}</span>
        </div>
        <div className="topbar-right">
          <div className="tools">
            <button type="button" onClick={() => setReceiptsOpen(true)}>
              Kvitton
            </button>
            <button type="button" onClick={() => setReport('x')}>
              X-rapport
            </button>
            {manager && (
              <button type="button" onClick={() => setReport('z')}>
                Z-rapport
              </button>
            )}
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={training}
              disabled={basket.length > 0 || trainingOnly}
              onChange={(e) => setTraining(e.target.checked)}
            />
            Träningsläge
          </label>
          <span className={`status ${online ? 'ok' : online === false ? 'down' : ''}`}>
            {online === null
              ? 'Ansluter…'
              : online
                ? 'Kontrollsystem online'
                : 'Kontrollsystem offline'}
          </span>
          <span className="who">
            {staff.displayName}
            <button type="button" className="link" onClick={onLogout} disabled={busy}>
              Logga ut
            </button>
          </span>
        </div>
      </header>

      <main className="layout">
        <section className="menu" aria-label="Meny">
          <nav className="groups">
            {menu.groups.map((g, i) => (
              <button
                key={g.name}
                type="button"
                className={i === groupIndex ? 'active' : ''}
                onClick={() => setGroupIndex(i)}
              >
                {g.name}
              </button>
            ))}
          </nav>
          <div className="articles">
            {group?.articles.map((a) => (
              <button key={a.id} type="button" className="article" onClick={() => add(a)}>
                <span className="article-name">{a.name}</span>
                <span className="article-price">{formatKr(a.priceOre)}</span>
              </button>
            ))}
            {menu.groups.length === 0 && <p className="muted">Menyn är tom.</p>}
          </div>
        </section>

        <aside className="basket" aria-label="Order">
          <h2>Order</h2>
          {basket.length === 0 ? (
            <p className="muted empty">Tryck på en rätt för att lägga till.</p>
          ) : (
            <ul className="basket-lines">
              {basket.map((l) => (
                <li key={l.article.id}>
                  <span className="line-name">{l.article.name}</span>
                  <span className="qty">
                    <button
                      type="button"
                      aria-label={`Ta bort en ${l.article.name}`}
                      onClick={() => changeQuantity(l.article.id, -1)}
                    >
                      −
                    </button>
                    <span>{l.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Lägg till en ${l.article.name}`}
                      onClick={() => changeQuantity(l.article.id, 1)}
                    >
                      +
                    </button>
                  </span>
                  <span className="line-total">{formatKr(l.quantity * l.article.priceOre)}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="totals">
            {preview?.vatTotals.map((v) => (
              <p key={v.vatRate} className="row small muted">
                <span>varav moms {v.vatRate}%</span>
                <span>{formatKr(v.vatOre)}</span>
              </p>
            ))}
            <p className="row grand-total">
              <span>Totalt</span>
              <span>{formatKr(total)}</span>
            </p>
          </div>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          <div className="pay-buttons">
            <button type="button" disabled={!canPay} onClick={() => pay('card', total)}>
              Kort
            </button>
            <button type="button" disabled={!canPay} onClick={() => pay('swish', total)}>
              Swish
            </button>
            <button type="button" disabled={!canPay} onClick={() => setCashOpen(true)}>
              Kontant
            </button>
          </div>
          {basket.length > 0 && (
            <button type="button" className="link" onClick={() => setBasket([])} disabled={busy}>
              Töm order
            </button>
          )}
        </aside>
      </main>

      {receiptsOpen && (
        <ReceiptsDialog
          canReturn={manager}
          onClose={() => setReceiptsOpen(false)}
          onDone={(receipt) => {
            setReceiptsOpen(false);
            setDone({ receipt, changeOre: 0 });
          }}
        />
      )}
      {report && <ReportDialog type={report} onClose={() => setReport(null)} />}
      {cashOpen && (
        <CashDialog
          totalOre={total}
          busy={busy}
          onPay={(amountOre, changeOre) => pay('cash', amountOre, changeOre)}
          onCancel={() => setCashOpen(false)}
        />
      )}
      {done && (
        <ReceiptView
          receipt={done.receipt}
          restaurantName={menu.restaurant.name}
          changeOre={done.changeOre}
          onNewSale={newSale}
        />
      )}
    </div>
  );
}
