import { defineStyles } from '../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../styles/theme.ts';

export const userBarStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    alignItems: 'center',
    gap: theme.margins[2],
    color: theme.colors.text.main,
    ...theme.typography.paragraphS,
  });

export const loginFormStyles = (theme: GlobalTheme) =>
  defineStyles({
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: theme.margins[2],
    width: '420px',
    maxWidth: '100%',
    ...theme.typography.paragraphS,
  });

export const loginErrorStyles = (theme: GlobalTheme) =>
  defineStyles({
    flexBasis: '100%',
    textAlign: 'right',
    color: theme.colors.error.main,
  });
