import type { QueryResult } from 'pg';
export function rows(r: QueryResult) { return r.rows; }
