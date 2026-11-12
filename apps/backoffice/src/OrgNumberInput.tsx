import { TextInput } from '@mantine/core';
import { parseOrgNumber } from '@pos/domain';
import { IconCircleCheckFilled } from '@tabler/icons-react';
import { useState } from 'react';
import { useT } from './i18n';

/** True for any form parseOrgNumber accepts: 556123-4567, 5561234567, 16…, 19…/20… */
export function isOrgNumberOk(value: string): boolean {
  try {
    parseOrgNumber(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Organisation number with the same check as the server. It complains only once the person
 * has typed a full number or left the field, never on the first keystroke.
 */
export function OrgNumberInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const [touched, setTouched] = useState(false);
  const digits = value.replace(/\D/g, '').length;
  const ok = isOrgNumberOk(value);
  const showError = !ok && value.trim() !== '' && (touched || digits >= 10);

  return (
    <TextInput
      label={t('Organisation number')}
      description={t('10 digits, e.g. 556123-4567. Sole traders use their personnummer.')}
      required
      inputMode="numeric"
      autoComplete="off"
      placeholder="556123-4567"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onBlur={() => setTouched(true)}
      error={
        showError
          ? t("This number doesn't add up. Check for a typo: the last digit is a check digit.")
          : undefined
      }
      rightSection={
        ok ? <IconCircleCheckFilled size={18} color="var(--mantine-color-brand-filled)" /> : null
      }
    />
  );
}
