import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');
  if (code) await createClient().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL('/', request.url));
}
