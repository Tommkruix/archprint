import type { User } from '@prisma/client';

export async function GET(): Promise<Response> {
  const user = { id: '1', name: 'a' } as User;
  return Response.json(user);
}
