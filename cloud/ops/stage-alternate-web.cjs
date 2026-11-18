const fs = require('node:fs/promises');
const path = require('node:path');

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg', '.txt', '.xml', '.webmanifest']);
const loginOnlyStyle = '<style>.web-auth-form form:has(input[autocomplete="current-password"]) :is(.web-text-button,.web-auth-switch){display:none}</style>';

async function stageAlternateWeb(source, destination, primaryOrigin, alternateOrigin, primarySender, loginOnly = false) {
  const primary = new URL(primaryOrigin), alternate = new URL(alternateOrigin);
  const privateDomain = primarySender?.split('@')[1]?.toLowerCase();
  if (!privateDomain || (primary.hostname !== privateDomain && !primary.hostname.endsWith(`.${privateDomain}`)) || alternate.hostname.endsWith(`.${privateDomain}`) || alternate.hostname === privateDomain) {
    throw new Error('Supply two distinct sites and the original account email sender.');
  }
  const inputRoot = await fs.realpath(source);
  const outputRoot = path.join(await fs.realpath(path.dirname(path.resolve(destination))), path.basename(destination));
  const relative = path.relative(inputRoot, outputRoot);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Stage the alternate web build outside the input directory.');
  }
  await fs.access(path.join(inputRoot, 'index.html'));
  await fs.mkdir(outputRoot);

  async function copyDirectory(input, output) {
    for (const entry of await fs.readdir(input, { withFileTypes: true })) {
      const from = path.join(input, entry.name), to = path.join(output, entry.name);
      if (entry.name.startsWith('.') || entry.name.toLowerCase().endsWith('.map')) continue;
      if (entry.name.toLowerCase().includes(privateDomain)) throw new Error('A public filename refers to the original domain.');
      if (entry.isDirectory()) {
        await fs.mkdir(to);
        await copyDirectory(from, to);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unexpected entry in web build: ${entry.name}`);
      let bytes = await fs.readFile(from);
      const extension = path.extname(entry.name).toLowerCase();
      if (textExtensions.has(extension)) {
        let text = bytes.toString('utf8')
          .replaceAll(` from ${primarySender}`, '')
          .replaceAll(primary.hostname, alternate.hostname);
        if (loginOnly && extension === '.html' && text.includes('id="root"')) {
          text = text.replace('</head>', `${loginOnlyStyle}</head>`);
        }
        bytes = Buffer.from(text);
      }
      if (bytes.toString('latin1').toLowerCase().includes(privateDomain)) {
        throw new Error(`Original domain is still present in ${entry.name}.`);
      }
      await fs.writeFile(to, bytes, { flag: 'wx' });
    }
  }

  await copyDirectory(inputRoot, outputRoot);
  return outputRoot;
}

if (require.main === module) {
  const [source, destination, primary, alternate, sender, mode] = process.argv.slice(2);
  if (!sender || (mode && mode !== '--login-only')) {
    console.error('Usage: node stage-alternate-web.cjs <input> <new-output> <original-origin> <alternate-origin> <original-mail-sender> [--login-only]');
    process.exitCode = 1;
  } else {
    stageAlternateWeb(source, destination, primary, alternate, sender, mode === '--login-only')
      .then(output => console.log(`Staged alternate web build at ${output}`))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { stageAlternateWeb };
