import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/schema';

export async function GET() {
  return NextResponse.json(await db.select().from(users));
}
