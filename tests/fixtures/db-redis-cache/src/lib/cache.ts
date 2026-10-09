import { eq } from 'drizzle-orm';
import { createClient } from 'redis';
import { users } from './schema';

const redis = createClient({ url: process.env.REDIS_URL });

export const userFilter = (id: string) => eq(users.id, id);
export const cache = redis;
