import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

export async function GET(): Promise<Response> {
  const users = await db.user.findMany();
  return Response.json(users);
}
