import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, cpSync } from 'node:fs';
let outputDir = 'dist-web';
export default defineConfig({ plugins: [react(), { name: 'web-entry', configResolved(config) { outputDir = config.build.outDir; }, closeBundle() { copyFileSync(resolve(outputDir, 'web.html'), resolve(outputDir, 'index.html')); copyFileSync('src/web/privacy.html', resolve(outputDir, 'privacy.html')); mkdirSync(resolve(outputDir, 'assets'), { recursive: true }); copyFileSync('assets/icon.png', resolve(outputDir, 'assets/icon.png')); cpSync('assets/thesaurus', resolve(outputDir, 'assets/thesaurus'), { recursive: true }); } }], server: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:3020' } }, build: { commonjsOptions: { include: [/node_modules/, /electron/], transformMixedEsModules: true }, outDir: 'dist-web', emptyOutDir: true, sourcemap: 'hidden', chunkSizeWarningLimit: 1800, rollupOptions: { input: resolve('web.html') } } });
