/// <reference types="vite/client" />
/// <reference types="@emotion/react/types/css-prop" />

interface ImportMetaEnv {
	readonly VITE_BASE_API_URL: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
