#!/usr/bin/env node
/**
 * 静态构建：把站点复制到 dist/，并做部署自检。
 * 输出可直接放到 GitHub Pages（仓库任意子路径均可运行）。
 * 自检失败会以非零退出码结束，避免把坏产物发上去。
 */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const COPY_ENTRIES = ['index.html', 'src'];

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

async function main() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  for (const entry of COPY_ENTRIES) {
    const from = path.join(root, entry);
    if (!existsSync(from)) throw new Error(`缺少构建输入：${entry}`);
    await cp(from, path.join(dist, entry), { recursive: true });
  }

  // GitHub Pages 需要的辅助文件
  const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8');
  await writeFile(path.join(dist, '404.html'), indexHtml, 'utf8');
  await writeFile(path.join(dist, '.nojekyll'), '', 'utf8');

  const files = (await walk(dist)).sort();
  const manifest = [];
  for (const file of files) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const content = await readFile(file);
    manifest.push({ path: rel, bytes: (await stat(file)).size, sha256: createHash('sha256').update(content).digest('hex').slice(0, 16) });
  }

  // 可复现构建：buildId 由产物内容派生，默认不写任何墙钟时间戳，
  // 因此「相同输入字节 → 相同 dist 字节」。只有显式设置 SOURCE_DATE_EPOCH 时才记录时间戳，并如实标注来源。
  const contentDigest = createHash('sha256')
    .update(manifest.map((f) => `${f.path}: ${f.bytes}: ${f.sha256}`).join('\n'))
    .digest('hex');
  const epochSeconds = Number(process.env.SOURCE_DATE_EPOCH);
  const hasEpoch = Number.isFinite(epochSeconds) && epochSeconds > 0;

  const info = {
    app: 'StudyMate-Web',
    version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
    buildId: `sha256:${contentDigest.slice(0, 16)}`,
    reproducible: true,
    timestampSource: hasEpoch
      ? `SOURCE_DATE_EPOCH=${Math.floor(epochSeconds)}（显式设置；未设置时构建产物不含任何墙钟时间）`
      : 'none（构建产物不含墙钟时间戳；如需时间戳请显式设置 SOURCE_DATE_EPOCH）',
    builtAt: hasEpoch ? new Date(Math.floor(epochSeconds) * 1000).toISOString() : null,
    deployment: {
      kind: 'static',
      basePathStrategy: '相对资源路径 + hash 路由，支持 https://<user>.github.io/<repo>/ 任意子路径',
      entry: 'index.html',
      spaFallback: '404.html',
    },
    manifest: {
      excludes: ['build-info.json'],
      note: 'files 列出 dist 中除 build-info.json 之外的全部文件；该清单文件记录的就是自身所描述的产物。',
    },
    totals: { files: manifest.length, bytes: manifest.reduce((n, f) => n + f.bytes, 0) },
    files: manifest,
  };
  await writeFile(path.join(dist, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`, 'utf8');

  const problems = await audit(path.join(dist));
  if (problems.length > 0) {
    console.error('构建自检未通过：');
    for (const p of problems) console.error(` - ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(`构建完成：dist/（${info.totals.files} 个文件，${(info.totals.bytes / 1024).toFixed(1)} KB）· buildId ${info.buildId}`);
  console.log(`入口：dist/index.html · 兜底：dist/404.html · 清单：dist/build-info.json`);
  console.log('部署自检：通过（无根绝对路径引用、相对资源均存在、hash 路由可用）');
}

async function audit(dir) {
  const problems = [];
  const files = await walk(dir);
  const html = await readFile(path.join(dir, 'index.html'), 'utf8');

  for (const file of files) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    if (/\.(html|css|js|mjs|json|svg)$/.test(rel)) {
      const text = await readFile(file, 'utf8');
      const absolute = [...text.matchAll(/(?:href|src)\s*=\s*["'](\/(?!\/)[^"']*)["']/g)].map((m) => m[1]);
      if (absolute.length > 0) problems.push(`${rel} 使用了根绝对路径引用（子路径部署会 404）：${absolute.slice(0, 3).join(', ')}`);
      if (/\/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{2} \d{4}/.test(text)) problems.push(`${rel} 疑似包含构建期墙钟时间，会破坏可复现性`);
    }
  }

  const refs = [...html.matchAll(/(?:href|src)\s*=\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
  for (const ref of refs) {
    const target = path.join(dir, ref.replace(/^\.\//, ''));
    if (!existsSync(target)) problems.push(`index.html 引用的资源不存在：${ref}`);
  }
  if (!html.includes('type="module"')) problems.push('index.html 没有以 ES 模块方式加载入口脚本');
  if (!existsSync(path.join(dir, '.nojekyll'))) problems.push('缺少 .nojekyll（GitHub Pages 可能忽略以 _ 开头的目录）');
  if (!existsSync(path.join(dir, '404.html'))) problems.push('缺少 404.html 兜底页');
  if (!existsSync(path.join(dir, 'src', 'main.js'))) problems.push('缺少 src/main.js 入口');
  return problems;
}

main().catch((error) => {
  console.error(`构建失败：${error.message}`);
  process.exitCode = 1;
});

