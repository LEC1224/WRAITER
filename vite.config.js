import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], server: { watch: { ignored: ['**/test-output/**', '**/release/**'] } }, build: { outDir: 'dist', chunkSizeWarningLimit: 1800 } });
