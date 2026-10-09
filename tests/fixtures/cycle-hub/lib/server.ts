import { codeHandler } from '@/artifacts/code/server';
import { sheetHandler } from '@/artifacts/sheet/server';
import { textHandler } from '@/artifacts/text/server';

export const createHandler = (kind: string) => ({ kind });

export const handlers = [codeHandler, sheetHandler, textHandler];
