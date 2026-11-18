// Rebuild the small source-available LanguageTool bridge after editing its Java
// source. Requires a JDK 21+ on PATH and the staged, pinned dependencies.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}.`);
}

async function main() {
  const payload = path.join(root, 'build', 'offline-grammar', 'payload');
  await fs.access(path.join(payload, 'lib', 'languagetool-core-6.8.jar'));
  const output = await fs.mkdtemp(path.join(root, 'build', 'offline-grammar', 'bridge-'));
  const source = path.join(root, 'tools', 'local-grammar', 'WraiterGrammar.java');
  const chunker = path.join(root, 'tools', 'local-grammar', 'RuleChunker.java');
  const jar = path.join(root, 'tools', 'local-grammar', 'WraiterGrammar.jar');
  run('javac', ['--release', '21', '-encoding', 'UTF-8', '-cp', path.join(payload, 'lib', '*'), '-d', output, source, chunker]);
  run('jar', ['--create', '--file', jar, '-C', output, 'WraiterGrammar.class', '-C', output, 'WraiterGrammar$1.class', '-C', output, 'RuleChunker.class']);
  console.log(`Rebuilt ${jar}. Run the offline grammar IPC tests before packaging.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
