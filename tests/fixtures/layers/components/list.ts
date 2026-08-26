import { fmt } from '@/utils/format';
import { Dashboard } from '@/features/dashboard';

export const List = (): string => fmt(`list:${Dashboard()}`);
