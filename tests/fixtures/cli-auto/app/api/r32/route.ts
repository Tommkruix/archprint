import { util } from '@/lib/util';
export async function GET() {
  return new Response(String(util) + '32');
}
