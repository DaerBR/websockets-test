import { FormEvent, useState } from 'react';
import { inputStyles, sendButtonStyles } from '../../styles/chatStyles.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import { loginErrorStyles, loginFormStyles } from './styles.ts';
import { useThunk } from '../../store/hooks/useThunk.ts';
import { signIn } from '../../store/thunks/auth.ts';
import { useAppSelector } from '../../store/hooks/hooks.ts';

export const LoginForm = () => {
  const theme = useAppTheme();
  const [userName, setUserName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [dispatchSignIn, signInError] = useThunk(signIn);
  const isLoading = useAppSelector((state) => state.auth.isLoading);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    await dispatchSignIn({ name: userName.trim(), password });
  };

  return (
    <form css={loginFormStyles(theme)} onSubmit={handleLogin}>
      <input
        type="text"
        placeholder="Name"
        aria-label="Name"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        css={inputStyles(theme)}
      />
      <input
        autoComplete="off"
        type="password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        css={inputStyles(theme)}
      />
      <button
        type="submit"
        disabled={userName.trim() === '' || password === '' || isLoading}
        css={sendButtonStyles(theme)}
      >
        Log in
      </button>
      {signInError && 'message' in signInError && <span css={loginErrorStyles(theme)}>{signInError.message}</span>}
    </form>
  );
};
