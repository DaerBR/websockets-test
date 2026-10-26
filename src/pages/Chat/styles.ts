import { defineStyles } from '../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../styles/theme.ts';

type StatusColors = GlobalTheme['colors']['primary' | 'success' | 'error'];

export const containerStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.margins[4],
    maxWidth: '640px',
    margin: '0 auto',
    padding: theme.padding[6],
    boxSizing: 'border-box',
    minHeight: '100vh',
    color: theme.colors.text.main,
    ...theme.typography.paragraphM,
  });

export const statusBadgeStyles = (theme: GlobalTheme, statusColors: StatusColors) =>
  defineStyles({
    alignSelf: 'flex-start',
    padding: `${theme.padding[1]} ${theme.padding[3]}`,
    borderRadius: '999px',
    backgroundColor: statusColors.surfaceSubtle,
    color: statusColors.dark,
    fontWeight: theme.fontWeight[600],
    ...theme.typography.paragraphS,
  });

export const messageListStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.margins[2],
    flex: 1,
    minHeight: '240px',
    maxHeight: '60vh',
    overflowY: 'auto',
    padding: theme.padding[4],
    border: `1px solid ${theme.colors.neutral.surfaceLighter}`,
    borderRadius: '8px',
    boxShadow: theme.boxShadows.sm,
    backgroundColor: '#fff',
  });

export const messageStyles = (theme: GlobalTheme) =>
  defineStyles({
    alignSelf: 'flex-start',
    padding: `${theme.padding[2]} ${theme.padding[3]}`,
    borderRadius: '8px',
    backgroundColor: theme.colors.neutral.surfaceSubtle,
    wordBreak: 'break-word',
  });

export const lastMessageStyles = (theme: GlobalTheme) =>
  defineStyles({
    color: theme.colors.text.caption,
    ...theme.typography.paragraphS,
  });

export const inputRowStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    gap: theme.margins[2],
  });

export const inputStyles = (theme: GlobalTheme) =>
  defineStyles({
    flex: 1,
    padding: `${theme.padding[2]} ${theme.padding[3]}`,
    border: `1px solid ${theme.colors.neutral.surfaceLighter}`,
    borderRadius: '8px',
    font: 'inherit',
    '&:focus': { outline: `2px solid ${theme.colors.primary.light}`, outlineOffset: '1px' },
  });

export const sendButtonStyles = (theme: GlobalTheme) =>
  defineStyles({
    padding: `${theme.padding[2]} ${theme.padding[5]}`,
    border: 'none',
    borderRadius: '8px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.text.contrast,
    font: 'inherit',
    fontWeight: theme.fontWeight[600],
    cursor: 'pointer',
    '&:hover:not(:disabled)': { backgroundColor: theme.colors.primary.dark },
    '&:disabled': { backgroundColor: theme.colors.primary.disabled, cursor: 'not-allowed' },
  });
