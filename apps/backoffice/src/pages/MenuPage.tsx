import type { VatRate } from '@pos/domain';
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Article, type MenuGroup } from '../api';
import { formatKr, parseKr } from '../format';
import { useT } from '../i18n';
import { useAction, useLoad } from '../useLoad';

const VAT_OPTIONS: { rate: VatRate; label: string }[] = [
  { rate: 12, label: '12% (food)' },
  { rate: 25, label: '25% (alcohol)' },
  { rate: 6, label: '6%' },
  { rate: 0, label: '0%' },
];

/** Menu per restaurant. Changes reach the tills at once; old receipts keep their prices. */
export function MenuPage({ tenantId }: { tenantId: string }) {
  const t = useT();
  const restaurants = useLoad(() => api.restaurants(tenantId), [tenantId]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  useEffect(() => {
    const list = restaurants.data?.restaurants ?? [];
    if (list.length > 0 && !list.some((r) => r.id === restaurantId)) setRestaurantId(list[0]!.id);
  }, [restaurants.data, restaurantId]);

  return (
    <section>
      <header className="page-header">
        <h1>{t('Menu')}</h1>
        {restaurants.data && restaurants.data.restaurants.length > 1 && (
          <select value={restaurantId ?? ''} onChange={(e) => setRestaurantId(e.target.value)}>
            {restaurants.data.restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </header>
      {restaurants.error && <p className="error">{t(restaurants.error)}</p>}
      {restaurantId && (
        <MenuEditor key={restaurantId} tenantId={tenantId} restaurantId={restaurantId} />
      )}
    </section>
  );
}

function MenuEditor({ tenantId, restaurantId }: { tenantId: string; restaurantId: string }) {
  const t = useT();
  const { data, error, reload } = useLoad(
    () => api.menu(tenantId, restaurantId),
    [tenantId, restaurantId],
  );
  const action = useAction();
  const [groupName, setGroupName] = useState('');

  async function addGroup(e: FormEvent) {
    e.preventDefault();
    const sortOrder = (data?.groups.length ?? 0) + 1;
    if (
      await action.run(() => api.addGroup(tenantId, restaurantId, { name: groupName, sortOrder }))
    ) {
      setGroupName('');
      reload();
    }
  }

  const save = async (fn: () => Promise<unknown>) => {
    if (await action.run(fn)) reload();
  };

  if (!data) {
    return error ? <p className="error">{t(error)}</p> : <p className="muted">{t('Loading…')}</p>;
  }

  const sections: { group: MenuGroup | null; articles: Article[] }[] = [
    ...data.groups.map((g) => ({
      group: g,
      articles: data.articles.filter((a) => a.menuGroupId === g.id),
    })),
    { group: null, articles: data.articles.filter((a) => a.menuGroupId === null) },
  ];

  return (
    <>
      {action.error && <p className="error">{t(action.error)}</p>}
      {sections.map(({ group, articles }) => (
        <div
          key={group?.id ?? 'none'}
          className={`card ${group && !group.active ? 'inactive' : ''}`}
        >
          <div className="card-header">
            {group ? (
              <InlineText
                value={group.name}
                onSave={(name) => save(() => api.updateGroup(tenantId, group.id, { name }))}
                className="h2"
              />
            ) : (
              <h2 className="muted">{t('No group')}</h2>
            )}
            {group && (
              <label className="toggle small">
                <input
                  type="checkbox"
                  checked={group.active}
                  onChange={(e) =>
                    save(() => api.updateGroup(tenantId, group.id, { active: e.target.checked }))
                  }
                />
                {t('Shown at the till')}
              </label>
            )}
          </div>
          <table>
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th className="num">{t('Price')}</th>
                <th>{t('VAT')}</th>
                <th>{t('Group')}</th>
                <th>{t('At the till')}</th>
              </tr>
            </thead>
            <tbody>
              {articles.map((a) => (
                <ArticleRow
                  key={a.id}
                  article={a}
                  groups={data.groups}
                  tenantId={tenantId}
                  save={save}
                />
              ))}
              {articles.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t('No items.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <NewArticleForm
            groupId={group?.id ?? null}
            onAdd={(body) => save(() => api.addArticle(tenantId, restaurantId, body))}
          />
        </div>
      ))}
      <form className="card inline-form" onSubmit={addGroup}>
        <strong>{t('New group')}</strong>
        <input
          required
          placeholder={t('e.g. Starters')}
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
        />
        <button className="primary small" disabled={action.busy}>
          {t('Add group')}
        </button>
      </form>
    </>
  );
}

function ArticleRow({
  article,
  groups,
  tenantId,
  save,
}: {
  article: Article;
  groups: MenuGroup[];
  tenantId: string;
  save: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const t = useT();
  const update = (body: Partial<Omit<Article, 'id'>>) =>
    save(() => api.updateArticle(tenantId, article.id, body));
  return (
    <tr className={article.active ? '' : 'muted'}>
      <td>
        <InlineText value={article.name} onSave={(name) => update({ name })} />
      </td>
      <td className="num">
        <InlineText
          value={(article.priceOre / 100).toFixed(2).replace('.', ',')}
          display={formatKr(article.priceOre)}
          validate={(v) => parseKr(v) !== null}
          onSave={(v) => update({ priceOre: parseKr(v)! })}
        />
      </td>
      <td>
        <select
          value={article.vatRate}
          onChange={(e) => update({ vatRate: Number(e.target.value) as VatRate })}
        >
          {VAT_OPTIONS.map((o) => (
            <option key={o.rate} value={o.rate}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </td>
      <td>
        <select
          value={article.menuGroupId ?? ''}
          onChange={(e) => update({ menuGroupId: e.target.value || null })}
        >
          <option value="">{t('No group')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={t('Shown at the till')}
          checked={article.active}
          onChange={(e) => update({ active: e.target.checked })}
        />
      </td>
    </tr>
  );
}

function NewArticleForm({
  groupId,
  onAdd,
}: {
  groupId: string | null;
  onAdd: (body: {
    name: string;
    priceOre: number;
    vatRate: VatRate;
    menuGroupId: string | null;
  }) => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [vatRate, setVatRate] = useState<VatRate>(12);
  const priceOre = parseKr(price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (priceOre === null) return;
    await onAdd({ name, priceOre, vatRate, menuGroupId: groupId });
    setName('');
    setPrice('');
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input
        required
        placeholder={t('New item')}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        required
        inputMode="decimal"
        placeholder={t('Price in kr')}
        className={price && priceOre === null ? 'invalid' : ''}
        value={price}
        onChange={(e) => setPrice(e.target.value)}
      />
      <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value) as VatRate)}>
        {VAT_OPTIONS.map((o) => (
          <option key={o.rate} value={o.rate}>
            {t(o.label)}
          </option>
        ))}
      </select>
      <button className="primary small" disabled={!name || priceOre === null}>
        {t('Add')}
      </button>
    </form>
  );
}

/** Click to edit; Enter or leaving the field saves, Escape cancels. */
function InlineText({
  value,
  display,
  onSave,
  validate = (v) => v.trim().length > 0,
  className = '',
}: {
  value: string;
  display?: string;
  onSave: (value: string) => Promise<void>;
  validate?: (value: string) => boolean;
  className?: string;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit ${className}`}
        title={t('Click to change')}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {display ?? value}
      </button>
    );
  }

  const commit = async () => {
    setEditing(false);
    if (draft !== value && validate(draft)) await onSave(draft.trim());
  };

  return (
    <input
      autoFocus
      className={validate(draft) ? '' : 'invalid'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
