import { createClient as createAdminClient } from '@supabase/supabase-js';
import type { Database } from '@/types/db';

export const supabaseAdmin = createAdminClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
