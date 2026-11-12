import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Radio,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import type { Article } from './api';
import { formatKr } from './format';
import { useT } from './i18n';

interface Props {
  article: Article;
  onAdd: (optionIds: string[]) => void;
  onClose: () => void;
}

const delta = (ore: number) =>
  ore === 0 ? '' : `${ore > 0 ? '+' : '−'}${formatKr(Math.abs(ore))}`;

/** Pick sizes and extras for an item. Required groups must be answered before adding. */
export function OptionsDialog({ article, onAdd, onClose }: Props) {
  const t = useT();
  // Pre-select the first option where exactly one choice is required: the usual pick.
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      article.optionGroups.map((g) => [
        g.id,
        g.minSelect === 1 && g.maxSelect === 1 && g.options[0] ? [g.options[0].id] : [],
      ]),
    ),
  );

  const chosen = Object.values(picked).flat();
  const price =
    article.priceOre +
    article.optionGroups
      .flatMap((g) => g.options)
      .filter((o) => chosen.includes(o.id))
      .reduce((sum, o) => sum + o.priceDeltaOre, 0);
  const missing = article.optionGroups.filter((g) => (picked[g.id]?.length ?? 0) < g.minSelect);

  const toggle = (groupId: string, optionId: string, max: number) =>
    setPicked((p) => {
      const current = p[groupId] ?? [];
      if (current.includes(optionId))
        return { ...p, [groupId]: current.filter((id) => id !== optionId) };
      if (current.length >= max) return p;
      return { ...p, [groupId]: [...current, optionId] };
    });

  return (
    <Modal
      opened
      onClose={onClose}
      size="md"
      title={
        <div>
          <Text fw={650} fz="lg">
            {article.name}
          </Text>
          <Text fz="sm" c="dimmed" className="mono">
            {formatKr(article.priceOre)}
          </Text>
        </div>
      }
    >
      <Stack gap="lg">
        {article.optionGroups.map((g) => {
          const single = g.maxSelect === 1;
          const hint =
            g.minSelect === 0
              ? g.maxSelect === 1
                ? t('Optional')
                : t('Optional, up to {count}', { count: g.maxSelect })
              : g.minSelect === g.maxSelect
                ? t('Choose {count}', { count: g.minSelect })
                : t('Choose {min}–{max}', { min: g.minSelect, max: g.maxSelect });
          return (
            <Stack key={g.id} gap={8}>
              <Group justify="space-between">
                <Text fw={600}>{g.name}</Text>
                <Badge
                  variant={g.minSelect > 0 ? 'light' : 'default'}
                  color={g.minSelect > 0 ? 'orange' : 'gray'}
                >
                  {hint}
                </Badge>
              </Group>
              <Stack gap={6}>
                {g.options.map((o) => {
                  const on = picked[g.id]?.includes(o.id) ?? false;
                  return (
                    <UnstyledButton
                      key={o.id}
                      className="option-row"
                      data-checked={on}
                      onClick={() =>
                        single
                          ? setPicked((p) => ({
                              ...p,
                              [g.id]: on && g.minSelect === 0 ? [] : [o.id],
                            }))
                          : toggle(g.id, o.id, g.maxSelect)
                      }
                    >
                      <Group justify="space-between" wrap="nowrap">
                        <Group gap="sm" wrap="nowrap">
                          {single ? (
                            <Radio checked={on} readOnly tabIndex={-1} />
                          ) : (
                            <Checkbox checked={on} readOnly tabIndex={-1} />
                          )}
                          <Text fw={500}>{o.name}</Text>
                        </Group>
                        <Text fz="sm" c="dimmed" className="mono">
                          {delta(o.priceDeltaOre)}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  );
                })}
              </Stack>
            </Stack>
          );
        })}

        <Button size="lg" h={56} disabled={missing.length > 0} onClick={() => onAdd(chosen)}>
          {missing.length > 0
            ? t('Choose {name}', { name: missing[0]!.name })
            : t('Add · {amount}', { amount: formatKr(price) })}
        </Button>
      </Stack>
    </Modal>
  );
}
