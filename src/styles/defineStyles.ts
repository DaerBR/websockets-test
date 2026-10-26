import type { CSSObject } from '@emotion/react';

/**
 * Wrap a style object literal in this so its properties are checked against `CSSObject`
 * (giving TypeScript the narrow literal types it needs for enum-like CSS properties like
 * `position`/`display`/`flexDirection`) without widening to plain `CSSObject` or needing
 * per-property `as const`.
 */
export const defineStyles = <TStyles extends CSSObject>(styles: TStyles): TStyles => styles;
