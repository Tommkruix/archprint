import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

export async function GET() {
  return Response.json(await db.report.findMany());
}
