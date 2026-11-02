import { FormEvent, useState } from 'react';
import { isAxiosError } from 'axios';
import { inputStyles, sendButtonStyles } from '../../pages/Chat/styles.ts';
import { useAppTheme } from '../../styles/hooks.ts';
import { signIn } from '../../auth/authStore.ts';
import { loginErrorStyles, loginFormStyles } from './styles.ts';

export const LoginForm = () => {
  const theme = useAppTheme();
  const [userName, setUserName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      await signIn(userName.trim(), password);
    } catch (loginError) {
      const isWrongPassword = isAxiosError(loginError) && loginError.response?.status === 401;
      setError(isWrongPassword ? 'Wrong name or password' : 'Login failed, try again');
    } finally {
      setIsSubmitting(false);
    }
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
        type="password"
        placeholder="Password"
        aria-label="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        css={inputStyles(theme)}
      />
      <button
        type="submit"
        disabled={userName.trim() === '' || password === '' || isSubmitting}
        css={sendButtonStyles(theme)}
      >
        Log in
      </button>
      {error && <span css={loginErrorStyles(theme)}>{error}</span>}
    </form>
  );
};
