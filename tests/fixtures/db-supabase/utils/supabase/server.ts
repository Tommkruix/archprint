import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/db';

export const createClient = () => {
  const cookieStore = cookies();
  return createServerClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll() },
  });
};
