// Isolated visual test: actual recovery shell/logger/boundary, synthetic data only.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const server = await createServer({ server: { host: '127.0.0.1', port: 5204, strictPort: true }, plugins: [{
  name: 'diagnostics-isolated-preview',
  configureServer(vite) {
    vite.middlewares.use(async (request, response, next) => {
      if (request.url?.split('?')[0] !== '/diagnostics-preview') return next();
      const source = await readFile(new URL('../index.html', import.meta.url), 'utf8');
      const html = source.replace('/src/main.jsx', '/scripts/diagnostics-preview/main.jsx');
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/diagnostics-preview', html));
    });
  },
}] });
await server.listen();
console.log('Isolated diagnostics preview: http://127.0.0.1:5204/diagnostics-preview?page=annual');
