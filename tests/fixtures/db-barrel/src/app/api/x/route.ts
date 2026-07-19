import { db } from '@/db';
export async function GET() { return new Response(String(db)); }
