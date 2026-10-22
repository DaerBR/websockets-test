import type { GlobalTheme } from './theme.ts';

declare module '@emotion/react' {
	export interface Theme extends GlobalTheme {}
}
