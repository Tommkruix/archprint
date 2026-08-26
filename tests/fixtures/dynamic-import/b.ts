export async function b(): Promise<number> {
  const mod = await import('@/a');
  return mod.a() - 1;
}
