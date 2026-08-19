/**
 * 组装一个与真实备份包同构的样例备份，用于验证查看器在 file:// 下能否直接打开
 *
 * 产出：viewer/filetest/
 *   ├── Common/json/*.js、Messages/json/messages.js   ← 样例数据（同 viewer/mock）
 *   └── index.html、viewer.js、viewer.css、vendor/  ← 查看器构建产物（位于备份根目录）
 * 验证方式：浏览器直接打开 viewer/filetest/index.html（file:// 协议）
 *
 * 用法：node scripts/gen-viewer-filetest.mjs（需先 npm run build:viewer）
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'viewer/filetest');
const mock = resolve(root, 'viewer/mock');
const dist = resolve(root, 'public/viewer');

if (!existsSync(mock)) {
    throw new Error('缺少样例数据，请先执行 node scripts/gen-viewer-mock.mjs');
}
if (!existsSync(dist)) {
    throw new Error('缺少查看器产物，请先执行 npm run build:viewer');
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// 数据与查看器均放在备份根目录——与真实备份包结构一致
cpSync(mock, target, { recursive: true });
cpSync(dist, target, { recursive: true });

console.log('已生成 file:// 验证用备份包：viewer/filetest');
console.log('请用浏览器打开：' + resolve(target, 'index.html'));
