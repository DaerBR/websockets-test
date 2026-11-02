import { create } from 'axios';
import { useEffect } from 'react';
import { NavigateFunction, useNavigate } from 'react-router';
import { API_URL } from './constants';

const HANDLES_OWN_UNAUTHORIZED = ['/login'];

export const apiRequest = create({
  baseURL: API_URL,
  withCredentials: true,
});

// Registered here, at module scope, instead of inside a component's useEffect: this file is imported (and
// this call runs) before any component can mount, so the interceptor is guaranteed to be attached before a
// page's own on-mount fetch can fire. Registering it from a component effect would race — a descendant's
// effect that fetches on mount runs before an ancestor's effect, so its request could go out before the
// interceptor existed and silently skip it.
let currentNavigate: NavigateFunction | null = null;

apiRequest.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const handlesOwnUnauthorized = HANDLES_OWN_UNAUTHORIZED.includes(error.config?.url);

    if ((status === 401 && !handlesOwnUnauthorized) || status === 403) {
      console.info('Unauthorized access, redirecting to sign-in page');
      currentNavigate?.('/');
    }

    if (status === 404) {
      currentNavigate?.('/not-found');
    }

    return Promise.reject(error);
  },
);

// The interceptor above needs react-router's `navigate`, which is only available inside components. This
// hook just keeps `currentNavigate` pointed at the live navigate function; it does not set up any
// interceptor itself.
export const useApiNavigate = () => {
  const navigate = useNavigate();

  useEffect(() => {
    currentNavigate = navigate;
  }, [navigate]);
};
