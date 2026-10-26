import { globSync, readFileSync } from 'node:fs';
import postcss from 'postcss';

// Parse each file before bundling so a dangling selector cannot capture the next file's rule.
const files = [...globSync('src/**/*.css'), ...globSync('public/**/*.css')];
let invalid = 0;
for (const file of files) {
  try {
    postcss.parse(readFileSync(file, 'utf8'), { from: file });
  } catch (error) {
    invalid++;
    console.error(error.toString());
  }
}
if (invalid) process.exitCode = 1;
else console.log(`CSS syntax: ${files.length} files passed`);
