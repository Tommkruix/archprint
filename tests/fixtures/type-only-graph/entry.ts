import type { T } from './t';
import { v } from './v';
export const use = (x: T): number => v() + (x ? 1 : 0);
