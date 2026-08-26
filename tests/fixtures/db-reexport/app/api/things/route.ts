import { PrismaClient } from '@/lib/db';

export async function GET(): Promise<Response> {
  return Response.json({ hasClient: typeof PrismaClient === 'function' });
}
