const fs = require('node:fs');
const path = require('node:path');

// Chromium reads versioned dictionaries from this profile cache at startup.
// Preserve any existing files and personal word lists. A cache write failure
// must not prevent the editor itself from opening.
function seedOfflineDictionaries(resources, userData) {
  const source = path.join(resources, 'dictionaries'), destination = path.join(userData, 'Dictionaries');
  let entries;
  try { entries = fs.readdirSync(source, { withFileTypes: true }); fs.mkdirSync(destination, { recursive: true }); }
  catch { return { copied: 0, failed: 0 }; }
  let copied = 0, failed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z]{2,3}(?:-[a-z0-9]+)*-\d+-\d+\.bdic$/i.test(entry.name)) continue;
    try { fs.copyFileSync(path.join(source, entry.name), path.join(destination, entry.name), fs.constants.COPYFILE_EXCL); copied++; }
    catch (error) { if (error.code !== 'EEXIST') failed++; }
  }
  return { copied, failed };
}
module.exports = { seedOfflineDictionaries };
