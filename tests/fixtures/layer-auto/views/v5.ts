import type { h1 } from '../helpers/h1';
import { h5 } from '../helpers/h5';
export const v5 = (fn: typeof h1): number => fn() + h5();
