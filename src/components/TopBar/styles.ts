import { defineStyles } from '../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../styles/theme.ts';

export const topBarStyles = (theme: GlobalTheme) =>
  defineStyles({
    position: 'fixed',
    top: theme.padding[3],
    right: theme.padding[3],
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.margins[2],
  });
