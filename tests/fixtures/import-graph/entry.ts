import { rel } from './rel';
import { aliased } from '@/aliased';
import { join } from 'node:path';

export const go = (): number => rel() + aliased() + join('a', 'b').length;
export const load = (): Promise<typeof import('@/dynamic')> => import('@/dynamic');
