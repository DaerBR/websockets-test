import { useEffect } from 'react';
import { leaveButtonStyles } from '../../pages/Rooms/styles.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import { LoginForm } from './LoginForm.tsx';
import { userBarStyles } from './styles.ts';
import { useAppSelector } from '../../store/hooks/hooks.ts';
import { useThunk } from '../../store/hooks/useThunk.ts';
import { fetchUser, signOut } from '../../store/thunks/auth.ts';

export const UserBar = () => {
  const theme = useAppTheme();
  const { isUserFetched, userData } = useAppSelector((state) => state.auth);
  const { name, role } = userData ?? {};
  const [dispatchFetchUser] = useThunk(fetchUser);
  const [dispatchSignOut] = useThunk(signOut);

  useEffect(() => {
    if (!isUserFetched) {
      dispatchFetchUser();
    }
  }, [dispatchFetchUser, isUserFetched]);

  if (!isUserFetched) {
    return null;
  }

  if (userData === null) {
    return <LoginForm />;
  }

  return (
    <div css={userBarStyles(theme)}>
      {name && <span>{`Logged in as ${name}${role === 'admin' ? ' (admin)' : ''}`}</span>}
      <button type="button" onClick={() => dispatchSignOut()} css={leaveButtonStyles(theme)}>
        Log out
      </button>
    </div>
  );
};
