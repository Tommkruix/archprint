import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { createRemoteServer } from './server.js';

export interface RemoteHttpOptions {
  maxConcurrent?: number;
  maxBodyBytes?: number;
  serverFactory?: () => McpServer;
}

const MCP_PATH = '/mcp';
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function createRemoteHttpServer(version: string, options: RemoteHttpOptions = {}): Server {
  const maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const serverFactory = options.serverFactory ?? (() => createRemoteServer(version));
  let inFlight = 0;

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz')
        return drainAnd(req, res, 200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === MCP_PATH) {
        return drainAnd(req, res, 405, { error: 'This server is stateless; use POST to /mcp.' });
      }
      if (req.method !== 'POST' || url.pathname !== MCP_PATH)
        return drainAnd(req, res, 404, { error: 'Not found.' });
      if (inFlight >= maxConcurrent) {
        return drainAnd(req, res, 429, { error: 'Too many concurrent requests, retry shortly.' });
      }
      inFlight++;
      try {
        const body = await readJsonBody(req, maxBodyBytes);
        const server = serverFactory();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        try {
          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        } finally {
          void transport.close();
          void server.close();
        }
      } finally {
        inFlight--;
      }
    } catch (error) {
      if (!res.headersSent) sendJson(res, 400, { error: (error as Error).message });
    }
  }

  return createServer((req, res) => void serve(req, res));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function drainAnd(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  req.resume();
  sendJson(res, status, body);
}

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        reject(new Error('Request body too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}
