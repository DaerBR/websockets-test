import { defineStyles } from '../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../styles/theme.ts';

export const connectionButtonsStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    gap: theme.margins[2],
  });
