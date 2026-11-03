import { useAppTheme } from '../../../styles/hooks.ts';
import { chatStatusBadgeStyles } from './styles.ts';
import { useAppSelector } from '../../../store/hooks/hooks.ts';

export const ChatStatusBadge = () => {
  const theme = useAppTheme();
  const status = useAppSelector((state) => state.chat.status);

  const statusColors = {
    connecting: theme.colors.primary,
    open: theme.colors.success,
    closed: theme.colors.error,
  }[status];

  return <div css={chatStatusBadgeStyles(theme, statusColors)}>{`Shared socket: ${status}`}</div>;
};
