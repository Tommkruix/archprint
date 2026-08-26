import { List } from '@/components/list';
import { fmt } from '@/utils/format';

export const Chart = (): string => `${List()}:${fmt('c')}`;
