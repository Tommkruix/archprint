import { type Prisma } from '@prisma/client';

export async function GET(): Promise<Response> {
  const value = null as Prisma.JsonValue;
  return Response.json({ value });
}
