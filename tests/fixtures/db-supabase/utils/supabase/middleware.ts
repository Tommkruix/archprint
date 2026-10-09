import * as ssr from '@supabase/ssr';

export const updateSession = (cookies: { getAll: () => { name: string; value: string }[] }) =>
  ssr.createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookies.getAll() },
  });
