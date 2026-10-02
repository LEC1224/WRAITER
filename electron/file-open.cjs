const path = require('node:path');

// Electron's development launcher adds the application directory after the exe.
// Explorer supplies ordinary argv entries, with quoting already removed.
function documentArguments(argv, workingDirectory, defaultApp = false) {
  const files = [], seen = new Set();
  for (const argument of argv.slice(defaultApp ? 2 : 1)) {
    if (typeof argument !== 'string' || argument.startsWith('-') || argument.includes('\0')) continue;
    const target = argument.replace(/^"(.*)"$/, '$1');
    if (path.extname(target).toLowerCase() !== '.wraiter') continue;
    const absolute = path.resolve(workingDirectory, target);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (!seen.has(key)) { seen.add(key); files.push(absolute); }
  }
  return files;
}

module.exports = { documentArguments };
