import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const dialogRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: dialogRoot,
  plugins: [viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('../apps-script/dist', import.meta.url)),
    emptyOutDir: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: fileURLToPath(new URL('./dialog.html', import.meta.url)),
    },
  },
});
