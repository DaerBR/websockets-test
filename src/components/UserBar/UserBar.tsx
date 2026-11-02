import { useAuth } from '../../auth/hooks.ts';
import { signOut } from '../../auth/authStore.ts';
import { leaveButtonStyles } from '../../pages/Rooms/styles.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import { LoginForm } from './LoginForm.tsx';
import { userBarStyles } from './styles.ts';

export const UserBar = () => {
  const theme = useAppTheme();
  const { isUserFetched, user, role } = useAuth();

  if (!isUserFetched) {
    return null;
  }

  if (user === null) {
    return <LoginForm />;
  }

  return (
    <div css={userBarStyles(theme)}>
      <span>{`Logged in as ${user}${role === 'admin' ? ' (admin)' : ''}`}</span>
      <button type="button" onClick={signOut} css={leaveButtonStyles(theme)}>
        Log out
      </button>
    </div>
  );
};
