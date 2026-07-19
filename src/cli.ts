#!/usr/bin/env node
import { buildProgram } from './cli/program.js';

buildProgram()
  .parseAsync(process.argv)
  .catch((error: { code?: string; message?: string }) => {
    if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') {
      process.exit(0);
    }
    if (error.message) console.error(error.message);
    process.exit(1);
  });
