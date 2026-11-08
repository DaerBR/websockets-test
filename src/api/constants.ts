const FALLBACK_API_URL = '/api';

export const API_URL = import.meta.env.VITE_BASE_API_URL ?? FALLBACK_API_URL;

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

export const SERVER_URL = `${protocol}//${window.location.host}/ws`;

export const MAX_MESSAGE_LENGTH = 500;
