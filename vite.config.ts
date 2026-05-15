import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        client1: path.resolve(__dirname, 'client1/index.html'),
        client2: path.resolve(__dirname, 'client2/index.html'),
      },
    },
  },
  server: {
    port: 5173,
  },
});
