import Def from './leaf';

export async function load(): Promise<number> {
  const rel = await import('./leaf'); // relative dynamic
  const ext = await import('node:path'); // external dynamic (unresolvable to a first-party file)
  const missing = await import('@/missing'); // aliased dynamic with no target file
  const barrel = await import('@/barrel'); // dynamic through a barrel
  return Def() + rel.value + ext.sep.length + Object.keys(missing).length + barrel.impl;
}
