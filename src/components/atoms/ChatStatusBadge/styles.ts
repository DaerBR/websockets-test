import { defineStyles } from '../../../styles/defineStyles.ts';
import type { GlobalTheme } from '../../../styles/theme.ts';

type StatusColors = GlobalTheme['colors']['primary' | 'success' | 'error'];

export const chatStatusBadgeStyles = (theme: GlobalTheme, statusColors: StatusColors) =>
  defineStyles({
    position: 'fixed',
    top: theme.padding[3],
    right: theme.padding[3],
    padding: `${theme.padding[1]} ${theme.padding[3]}`,
    borderRadius: '999px',
    backgroundColor: statusColors.surfaceSubtle,
    color: statusColors.dark,
    fontWeight: theme.fontWeight[600],
    boxShadow: theme.boxShadows.sm,
    ...theme.typography.paragraphS,
  });
