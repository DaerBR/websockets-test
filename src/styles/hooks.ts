import { useTheme } from '@emotion/react';

import type { GlobalTheme } from './theme.ts';

export const useAppTheme = (): GlobalTheme => useTheme();
