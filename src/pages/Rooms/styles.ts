import { defineStyles } from '../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../styles/theme.ts';

export const roomHeaderStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.margins[2],
  });

export const roomTitleStyles = (theme: GlobalTheme) =>
  defineStyles({
    margin: 0,
    ...theme.typography.h5,
  });

export const joinFormStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.margins[2],
    padding: theme.padding[4],
    border: `1px solid ${theme.colors.neutral.surfaceLighter}`,
    borderRadius: '8px',
    boxShadow: theme.boxShadows.sm,
    backgroundColor: '#fff',
  });

export const fieldLabelStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.margins[1],
    color: theme.colors.text.caption,
    ...theme.typography.paragraphS,
  });

export const ownMessageStyles = (theme: GlobalTheme) =>
  defineStyles({
    alignSelf: 'flex-end',
    padding: `${theme.padding[2]} ${theme.padding[3]}`,
    borderRadius: '8px',
    backgroundColor: theme.colors.primary.surfaceSubtle,
    wordBreak: 'break-word',
  });

export const messageMetaStyles = (theme: GlobalTheme) =>
  defineStyles({
    color: theme.colors.text.caption,
    ...theme.typography.paragraphS,
  });

export const deliveryStyles = (theme: GlobalTheme, failed: boolean) =>
  defineStyles({
    marginLeft: theme.margins[2],
    color: failed ? theme.colors.error.main : theme.colors.text.caption,
    fontWeight: theme.fontWeight[600],
  });

export const typingStyles = (theme: GlobalTheme) =>
  defineStyles({
    minHeight: '1.5em',
    color: theme.colors.text.caption,
    fontStyle: 'italic',
    ...theme.typography.paragraphS,
  });

export const leaveButtonStyles = (theme: GlobalTheme) =>
  defineStyles({
    padding: `${theme.padding[1]} ${theme.padding[3]}`,
    border: `1px solid ${theme.colors.neutral.surfaceLighter}`,
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: theme.colors.text.main,
    font: 'inherit',
    cursor: 'pointer',
    '&:hover:not(:disabled)': { backgroundColor: theme.colors.neutral.surfaceSubtle },
    '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
  });
