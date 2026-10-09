import '@supabase/ssr';
import { createClient } from 'redis';

export const queue = createClient({ url: process.env.REDIS_URL });
