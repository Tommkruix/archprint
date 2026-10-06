'use server';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

export async function archiveOrder(id: string) {
  await db.order.update({ where: { id }, data: { archived: true } });
}
