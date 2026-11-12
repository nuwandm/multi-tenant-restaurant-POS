import {
  ActionIcon,
  Badge,
  Button,
  Card,
  createTheme,
  Input,
  Menu,
  Modal,
  NavLink,
  Notification,
  Paper,
  SegmentedControl,
  Table,
  ThemeIcon,
  Tooltip,
  type MantineColorsTuple,
} from '@mantine/core';

/**
 * Design system shared by the till and the back office (this file is identical in both apps).
 * Geist for text, Geist Mono for figures and codes; a zinc neutral scale; one deep green brand
 * colour used sparingly for primary actions and status.
 */

// A calm, slightly blue-leaning green. Shade 7 is the brand colour in light mode.
const brand: MantineColorsTuple = [
  '#edf8f3',
  '#dbefe6',
  '#b4dfcb',
  '#89cdae',
  '#63bc94',
  '#47ad80',
  '#349a6f',
  '#227d59',
  '#196448',
  '#0f4b36',
];

// Neutral zinc: cool enough to look crisp, warm enough not to feel clinical.
const gray: MantineColorsTuple = [
  '#fafafa',
  '#f4f4f5',
  '#e7e7ea',
  '#d6d6db',
  '#a5a5ae',
  '#76767f',
  '#56565e',
  '#3f3f46',
  '#27272a',
  '#18181b',
];

// Dark mode surfaces, lightest (text) to darkest (page).
const dark: MantineColorsTuple = [
  '#ececef',
  '#b4b4bd',
  '#8d8d97',
  '#62626b',
  '#3a3a41',
  '#2a2a30',
  '#1f1f24',
  '#17171b',
  '#111114',
  '#0b0b0d',
];

export type Density = 'compact' | 'comfortable';

export function createAppTheme(density: Density) {
  const compact = density === 'compact';
  return createTheme({
    primaryColor: 'brand',
    primaryShade: { light: 7, dark: 5 },
    colors: { brand, gray, dark },
    autoContrast: true,
    respectReducedMotion: true,
    cursorType: 'pointer',
    fontFamily: "'Geist Variable', 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontFamilyMonospace: "'Geist Mono Variable', 'Geist Mono', ui-monospace, Consolas, monospace",
    // The back office is read at a desk, so it is denser; the till is used by touch.
    fontSizes: compact
      ? { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem', xl: '1.125rem' }
      : { xs: '0.8125rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.25rem' },
    lineHeights: { xs: '1.45', sm: '1.5', md: '1.55', lg: '1.55', xl: '1.6' },
    headings: {
      fontFamily: "'Geist Variable', 'Geist', system-ui, sans-serif",
      fontWeight: '600',
      sizes: {
        h1: { fontSize: compact ? '1.75rem' : '2rem', lineHeight: '1.2' },
        h2: { fontSize: compact ? '1.375rem' : '1.625rem', lineHeight: '1.25' },
        h3: { fontSize: compact ? '1.125rem' : '1.25rem', lineHeight: '1.3' },
        h4: { fontSize: compact ? '1rem' : '1.125rem', lineHeight: '1.35' },
      },
    },
    radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
    defaultRadius: 'md',
    shadows: {
      xs: '0 1px 2px rgb(9 9 11 / 0.05)',
      sm: '0 1px 3px rgb(9 9 11 / 0.06), 0 1px 2px rgb(9 9 11 / 0.04)',
      md: '0 4px 12px -2px rgb(9 9 11 / 0.08), 0 2px 4px -2px rgb(9 9 11 / 0.05)',
      lg: '0 12px 28px -6px rgb(9 9 11 / 0.12), 0 4px 8px -4px rgb(9 9 11 / 0.06)',
      xl: '0 24px 48px -12px rgb(9 9 11 / 0.2)',
    },
    components: {
      Button: Button.extend({
        defaultProps: { radius: 'md' },
        styles: { root: { fontWeight: 550, letterSpacing: '-0.005em' } },
      }),
      ActionIcon: ActionIcon.extend({ defaultProps: { radius: 'md' } }),
      Badge: Badge.extend({
        defaultProps: { radius: 'sm', variant: 'light' },
        styles: { root: { textTransform: 'none', letterSpacing: 0, fontWeight: 550 } },
      }),
      Card: Card.extend({ defaultProps: { radius: 'lg', withBorder: true, shadow: 'xs' } }),
      Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
      Input: Input.extend({ defaultProps: { radius: 'md' } }),
      InputWrapper: Input.Wrapper.extend({
        styles: {
          label: { fontWeight: 500, marginBottom: 4 },
          description: { marginBottom: 6 },
        },
      }),
      Modal: Modal.extend({
        defaultProps: {
          centered: true,
          radius: 'lg',
          shadow: 'xl',
          overlayProps: { backgroundOpacity: 0.4, blur: 3 },
          transitionProps: { transition: 'pop', duration: 160 },
        },
        styles: { title: { fontWeight: 600 } },
      }),
      Menu: Menu.extend({
        defaultProps: {
          radius: 'md',
          shadow: 'lg',
          transitionProps: { transition: 'pop-top-right', duration: 120 },
        },
      }),
      NavLink: NavLink.extend({
        defaultProps: { variant: 'light' },
        styles: { root: { borderRadius: 'var(--mantine-radius-md)' }, label: { fontWeight: 500 } },
      }),
      Notification: Notification.extend({ defaultProps: { radius: 'md', withBorder: true } }),
      SegmentedControl: SegmentedControl.extend({ defaultProps: { radius: 'md' } }),
      Table: Table.extend({
        styles: {
          th: {
            fontSize: 'var(--mantine-font-size-xs)',
            fontWeight: 550,
            color: 'var(--mantine-color-dimmed)',
            letterSpacing: '0.01em',
          },
        },
      }),
      ThemeIcon: ThemeIcon.extend({ defaultProps: { variant: 'light', radius: 'md' } }),
      Tooltip: Tooltip.extend({ defaultProps: { radius: 'sm', withArrow: true, openDelay: 250 } }),
    },
  });
}
