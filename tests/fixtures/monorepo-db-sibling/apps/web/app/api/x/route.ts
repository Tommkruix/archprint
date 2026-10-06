import { db } from '@acme/db';
export async function GET() { return new Response(String(db)); }
