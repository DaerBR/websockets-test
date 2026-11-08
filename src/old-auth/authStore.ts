import { fetchUser, login, logout } from '../api/old-auth.ts';

type AuthState = { isUserFetched: boolean; role: 'admin' | 'user' | null; user: string | null };

let auth: AuthState = { isUserFetched: false, role: null, user: null };
const listeners = new Set<() => void>();

// Always a new object: useSyncExternalStore re-renders only when the snapshot changes by reference.
const setAuth = (next: Partial<AuthState>) => {
  auth = { ...auth, ...next };
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const loadUser = async () => {
  try {
    const { name, role } = await fetchUser();
    setAuth({ isUserFetched: true, role, user: name });
  } catch {
    console.warn('Could not fetch the user: treating as logged out');
    setAuth({ isUserFetched: true, role: null, user: null });
  }
};

// Errors are not caught here: the login form shows them.
export const signIn = async (name: string, password: string) => {
  const { name: user, role } = await login(name, password);
  setAuth({ role, user });
};

export const signOut = async () => {
  await logout();
  setAuth({ role: null, user: null });
};

export const authStore = {
  subscribe,
  getSnapshot: () => auth,
};
