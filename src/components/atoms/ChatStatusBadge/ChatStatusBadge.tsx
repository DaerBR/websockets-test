import { useChatStatus } from '../../../socket/hooks.ts';
import { useAppTheme } from '../../../styles/hooks.ts';
import { chatStatusBadgeStyles } from './styles.ts';

export const ChatStatusBadge = () => {
  const theme = useAppTheme();
  const status = useChatStatus();

  const statusColors = {
    connecting: theme.colors.primary,
    open: theme.colors.success,
    closed: theme.colors.error,
  }[status];

  return <div css={chatStatusBadgeStyles(theme, statusColors)}>{`Shared socket: ${status}`}</div>;
};
