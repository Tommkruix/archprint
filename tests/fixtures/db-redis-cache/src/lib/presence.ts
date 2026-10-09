import { type User } from '@supabase/ssr';
import { createClient } from 'redis';

const presence = createClient({ url: process.env.REDIS_URL });

export const markOnline = (user: User) => presence.set(`online:${user.id}`, '1');
