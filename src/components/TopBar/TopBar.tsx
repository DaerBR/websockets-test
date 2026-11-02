import { useAppTheme } from '../../styles/hooks.ts';
import { ChatStatusBadge } from '../atoms/ChatStatusBadge';
import { UserBar } from '../UserBar';
import { topBarStyles } from './styles.ts';

// App-wide, on every page: the shared socket's status and who is logged in.
export const TopBar = () => {
  const theme = useAppTheme();

  return (
    <div css={topBarStyles(theme)}>
      <ChatStatusBadge />
      <UserBar />
    </div>
  );
};
