import Def from './leaf';

export async function load(): Promise<number> {
  const rel = await import('./leaf');
  const ext = await import('node:path');
  const missing = await import('@/missing');
  const barrel = await import('@/barrel');
  return Def() + rel.value + ext.sep.length + Object.keys(missing).length + barrel.impl;
}
