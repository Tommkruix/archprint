import { login } from '@/src/features/auth/login';

export const session = (): string => login();
