#!/usr/bin/env node
/**
 * 本地静态服务器（仅用于本地预览与端到端测试）。
 * 用法：node scripts/serve.mjs [目录] [端口]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const dir = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createStaticServer(rootDir) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let filePath = path.join(rootDir, decodeURIComponent(url.pathname));
      if (url.pathname.endsWith('/')) filePath = path.join(filePath, 'index.html');
      try {
        const info = await stat(filePath);
        if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
      } catch {
        filePath = path.join(rootDir, '404.html');
        if (!(await exists(filePath))) filePath = path.join(rootDir, 'index.html');
        res.statusCode = 404;
      }
      const body = await readFile(filePath);
      res.setHeader('content-type', TYPES[path.extname(filePath)] || 'application/octet-stream');
      res.setHeader('cache-control', 'no-cache');
      res.end(body);
    } catch (error) {
      res.statusCode = 500;
      res.end(`server error: ${error.message}`);
    }
  });
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectRun) {
  createStaticServer(dir).listen(port, '127.0.0.1', () => {
    console.log(`静态服务器已启动：http://127.0.0.1:${port}/ （目录：${dir}）`);
  });
}
