import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'dist');

function runBuild() {
  return new Promise((resolve) => {
    // stdio: inherit —— 沙箱下抓取子进程管道会 EPERM，且构建日志对排查更有用
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'build.mjs')], { cwd: root, stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

before(async () => {
  const code = await runBuild();
  assert.equal(code, 0, 'npm run build 必须成功退出');
}, { timeout: 120000 });

async function walk(dir, files = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
  return files;
}

test('构建产物包含入口、GitHub Pages 兜底文件与构建清单', async () => {
  for (const file of ['index.html', '404.html', '.nojekyll', 'build-info.json', 'src/main.js', 'src/styles/app.css']) {
    assert.ok(existsSync(path.join(dist, file)), `缺少构建产物 ${file}`);
  }
  const info = JSON.parse(await readFile(path.join(dist, 'build-info.json'), 'utf8'));
  assert.equal(info.app, 'StudyMate-Web');
  assert.match(info.buildId, /^sha256:[0-9a-f]{16}$/, '构建应有内容派生的稳定 buildId');
  assert.equal(info.reproducible, true);
  assert.equal(info.builtAt, null, '默认构建不得写入墙钟时间戳（可复现性要求）');
  assert.match(info.timestampSource, /SOURCE_DATE_EPOCH/, '若需要时间戳，应如实标注来自 SOURCE_DATE_EPOCH');
  assert.equal(info.deployment.kind, 'static');
  assert.match(info.deployment.basePathStrategy, /子路径|hash/);
  assert.ok(info.totals.files > 20);
  // 清单本身记录的不是自己：实际文件数 = 清单条目 + build-info.json
  assert.equal(info.files.length + 1, (await walk(dist)).length, '清单条目数与实际文件数（含 build-info.json）应一致');
  assert.deepEqual(info.manifest.excludes, ['build-info.json']);
  assert.ok(!info.files.some((f) => f.path === 'build-info.json'), '清单不应包含自身');
  for (const entry of info.files) assert.ok((await stat(path.join(dist, entry.path))).size === entry.bytes, `${entry.path} 的大小与清单不一致`);
});

test('产物中不存在根绝对路径引用（任意仓库子路径都能部署）', async () => {
  for (const file of await walk(dist)) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    if (!/\.(html|css|js|mjs|json|svg)$/.test(rel)) continue;
    const text = await readFile(file, 'utf8');
    const absolute = [...text.matchAll(/(?:href|src)\s*=\s*["'](\/(?!\/)[^"']*)["']/g)].map((m) => m[1]);
    assert.deepEqual(absolute, [], `${rel} 含根绝对引用：${absolute.join(', ')}`);
  }
});

test('index.html 引用的资源全部存在，并以模块方式加载入口', async () => {
  const html = await readFile(path.join(dist, 'index.html'), 'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /type="module"/);
  assert.match(html, /viewport/);
  const refs = [...html.matchAll(/(?:href|src)\s*=\s*["'](\.\/[^"']+)["']/g)].map((m) => m[1]);
  assert.ok(refs.length >= 2, 'index.html 至少应引用样式与入口脚本');
  for (const ref of refs) assert.ok(existsSync(path.join(dist, ref.replace(/^\.\//, ''))), `引用的资源不存在：${ref}`);
});

test('可复现性：相同输入字节的两次构建产出完全相同的文件与哈希', async () => {
  const snapshot = async () => {
    const files = (await walk(dist)).sort();
    const out = {};
    for (const file of files) {
      const rel = path.relative(dist, file).split(path.sep).join('/');
      out[rel] = createHash('sha256').update(await readFile(file)).digest('hex');
    }
    return out;
  };
  const first = await snapshot();
  const code = await runBuild();
  assert.equal(code, 0, '第二次构建也必须成功');
  const second = await snapshot();
  assert.deepEqual(Object.keys(second), Object.keys(first), '两次构建的文件清单必须一致');
  for (const [rel, hash] of Object.entries(first)) {
    assert.equal(second[rel], hash, `${rel} 在两次构建之间发生了变化（构建不可复现）`);
  }
  assert.ok(!Object.keys(first).some((f) => f.includes('node_modules')), '产物不应包含依赖目录');
});

test('404 兜底就是同一份入口，且没有把源码仓库的杂项带进产物', async () => {
  const [index, fallback] = await Promise.all([
    readFile(path.join(dist, 'index.html'), 'utf8'),
    readFile(path.join(dist, '404.html'), 'utf8'),
  ]);
  assert.equal(index, fallback, '404.html 应与 index.html 一致（hash 路由可直接回首页）');
  const files = (await walk(dist)).map((f) => path.relative(dist, f).split(path.sep).join('/'));
  assert.ok(!files.some((f) => f.startsWith('tests/') || f.startsWith('tools/') || f.startsWith('docs/')), '测试/工具/文档不应进入产物');
  assert.ok(!files.some((f) => f.includes('probe')), '探测脚本不应进入产物');
});

