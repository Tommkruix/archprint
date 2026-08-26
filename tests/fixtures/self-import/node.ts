import { step as next } from '@/node';

export const step = (n: number): number => (n <= 0 ? 0 : next(n - 1));
