import { db } from '@acme/db';
import { local } from '@/local';
import { readFileSync } from 'node:fs';

export const use = [db, local, readFileSync];
