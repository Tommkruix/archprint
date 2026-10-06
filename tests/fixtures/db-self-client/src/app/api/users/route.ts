import { db } from '@/server/db';

export async function GET() {
  return Response.json(await db.user.findMany());
}
