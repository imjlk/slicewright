// Writes docs/commands.md from the command definitions through gunshi's generate().
import { writeFileSync } from 'node:fs';

import { generate } from 'gunshi/generator';

import { cliOptions, main, subCommands } from '../src/cli.js';
import { commandReference } from '../src/command-reference.js';

const path = new URL('../docs/commands.md', import.meta.url);
const text = await commandReference(cliOptions.name, Object.keys(subCommands), (name) =>
  generate(name, main, cliOptions),
);
writeFileSync(path, text);
process.stdout.write(`Wrote ${path.pathname}\n`);
