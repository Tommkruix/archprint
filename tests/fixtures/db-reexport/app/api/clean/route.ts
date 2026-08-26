import { formatTitle } from '@/lib/format';

export async function GET(): Promise<Response> {
  return Response.json({ title: formatTitle('ok') });
}
