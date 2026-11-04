const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const assets = [
  ['StoreLogo.png', 50, 50], ['Square44x44Logo.png', 44, 44],
  ['Square150x150Logo.png', 150, 150], ['Wide310x150Logo.png', 310, 150],
];

async function main() {
  const directory = path.join(root, 'build/appx'); await fs.mkdir(directory, { recursive: true });
  const listingDirectory = path.join(root, 'docs/store/images'); await fs.mkdir(listingDirectory, { recursive: true });
  const svg = await fs.readFile(path.join(root, 'assets/icon.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [name, width, height, destination = directory] of [...assets, ['AppTile300.png', 300, 300, listingDirectory]]) {
      await page.setViewportSize({ width, height });
      const size = Math.floor(Math.min(width, height) * 0.8);
      await page.setContent(`<style>html,body{margin:0;background:transparent}body{width:${width}px;height:${height}px;display:grid;place-items:center}svg{width:${size}px;height:${size}px}</style>${svg}`);
      await page.screenshot({ path: path.join(destination, name), omitBackground: true });
    }
  } finally { await browser.close(); }
  console.log('Generated Store package logos from the existing WRAITER SVG.');
}
module.exports = { assets };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
