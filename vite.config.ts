import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type { Plugin, Connect } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

const PROXY_PREFIX = '/proxy-redirect';
const TARGET_HEADER = 'x-proxy-target';

/**
 * Dynamic proxy plugin.
 *
 * Intercepts requests to /proxy-redirect/* and forwards them to the target
 * URL specified in the X-Proxy-Target header. This solves CORS for local
 * AI servers (localhost, private IPs) without requiring static proxy config.
 */
function dynamicProxyPlugin(): Plugin {
  return {
    name: 'dynamic-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (!req.url?.startsWith(PROXY_PREFIX)) return next();

        const target = req.headers[TARGET_HEADER] as string | undefined;
        if (!target) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing X-Proxy-Target header');
          return;
        }

        try {
          const targetUrl = new URL(target);
          const path = req.url.replace(PROXY_PREFIX, '') || '/';
          // Join paths: ensure exactly one slash between target pathname and request path
          const targetPath = targetUrl.pathname.endsWith('/')
            ? targetUrl.pathname + path.replace(/^\//, '')
            : targetUrl.pathname + path;

          const headers: Record<string, string> = {};
          const skipHeaders = new Set([
            'host', 'connection', 'keep-alive', 'transfer-encoding',
            'upgrade', 'proxy-connection', TARGET_HEADER,
          ]);

          for (const [key, value] of Object.entries(req.headers)) {
            if (!skipHeaders.has(key.toLowerCase()) && value) {
              headers[key] = Array.isArray(value) ? value[0] : value;
            }
          }

          headers['host'] = targetUrl.host;

          const body = ['GET', 'HEAD'].includes(req.method ?? '')
            ? undefined
            : await collectBody(req);

          const response = await fetch(targetUrl.protocol + '//' + targetUrl.host + targetPath, {
            method: req.method,
            headers,
            body,
          });

          const skipResponseHeaders = new Set([
            'transfer-encoding', 'connection', 'keep-alive', 'upgrade',
            'proxy-connection', 'content-encoding', 'content-length',
          ]);

          for (const [key, value] of response.headers.entries()) {
            if (!skipResponseHeaders.has(key.toLowerCase())) {
              res.setHeader(key, value);
            }
          }

          res.writeHead(response.status);

          if (req.method === 'HEAD') {
            res.end();
            return;
          }

          if (response.body) {
            const reader = response.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
          }
          res.end();
        } catch (error) {
          console.error(`[proxy-redirect] Failed to proxy to ${target}:`, error);
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway: Could not reach the target server.');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), dynamicProxyPlugin()],
});

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
