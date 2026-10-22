const FALLBACK_API_URL = 'http://localhost:3000';

export const API_URL = import.meta.env.VITE_BASE_API_URL ?? FALLBACK_API_URL;
