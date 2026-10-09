import * as supabase from '@supabase/ssr';
import { createClient } from 'redis';

const pubsub = createClient({ url: process.env.REDIS_URL });

export const supabaseHelpers = Object.keys(supabase);
export const publish = (channel: string, message: string) => pubsub.publish(channel, message);
