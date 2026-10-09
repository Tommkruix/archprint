import { b } from '@/b';
import { a as self } from '@/a';

export const a = (): number => b() + (typeof self === 'function' ? 1 : 0);
