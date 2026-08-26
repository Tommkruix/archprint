import { Button } from '@/components/button';
import { add } from '@/utils/math';

export const Dashboard = (): string => `${Button()}:${add(1, 2)}`;
