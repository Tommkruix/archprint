import type { Session } from '@supabase/supabase-js';
import { createClient } from 'redis';

const store = createClient({ url: process.env.REDIS_URL });

export const saveSession = (session: Session) => store.set(session.user.id, JSON.stringify(session));
