import fs from "node:fs";
import path from "node:path";
import { buildDesignSystem, compareWithDisk, diskReader, listPreviewFolders, listReadmeFiles, SYNC_COMMAND } from "./build";

/**
 * `npm run design-system:sync` writes the generated files of docs/design-system/.
 * `npm run design-system:check` (this file with --check) writes nothing: it exits 1
 * and lists each stale or missing file and each problem (#1773).
 */
const root = process.cwd();
const check = process.argv.includes("--check");
const read = diskReader(root);
const result = buildDesignSystem(read, () => listPreviewFolders(root));
const stale = compareWithDisk(result.files, read, listReadmeFiles(root));

if (result.problems.length > 0) {
  console.error("Design system problems:");
  for (const problem of result.problems) console.error(`  - ${problem}`);
}

if (check) {
  if (stale.length > 0) {
    console.error("Generated design system files are out of date:");
    for (const line of stale) console.error(`  - ${line}`);
  }
  if (stale.length > 0 || result.problems.length > 0) {
    console.error(`Run \`${SYNC_COMMAND}\` after fixing any problems above, and commit the result.`);
    process.exit(1);
  }
  console.log(`Design system is in sync (${result.files.size} generated files).`);
} else {
  if (result.problems.length > 0) {
    console.error("Nothing was written. Fix the problems above and run the sync again.");
    process.exit(1);
  }
  let written = 0;
  for (const [file, text] of result.files) {
    const target = path.join(root, file);
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === text) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
    written += 1;
    console.log(`wrote ${file}`);
  }
  for (const line of stale) {
    const match = /^unexpected: (\S+)/.exec(line);
    if (match) {
      fs.rmSync(path.join(root, match[1]));
      console.log(`removed ${match[1]}`);
    }
  }
  console.log(`Design system synced: ${written} file(s) changed, ${result.files.size - written} already current.`);
}
