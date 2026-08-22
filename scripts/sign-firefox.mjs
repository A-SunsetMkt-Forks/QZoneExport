/**
 * 本地对 Firefox 构建产物调 AMO 签名（web-ext sign）。
 *
 * 凭据从环境变量读取，不进仓库：
 *   JWT_ISSUER  — 即 web-ext 的 api key（AMO「Web extension 版本」页面生成）
 *   JWT_SECRET  — 即 web-ext 的 api secret
 * 也兼容 web-ext 惯用的 WEB_EXT_API_KEY / WEB_EXT_API_SECRET。
 *
 * 用法：先设置上面两个环境变量，再运行 `npm run sign:firefox`。
 * 产物：`.output/signed/*-an+fx.xpi`（channel=unlisted，个人自装用，非商店发布）。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// web-ext 的 bin 未在 package.json exports 导出，走 node_modules 绝对路径定位其入口脚本
const webExtPath = path.join(root, 'node_modules', 'web-ext', 'bin', 'web-ext.js');

const apiKey = process.env.JWT_ISSUER || process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.JWT_SECRET || process.env.WEB_EXT_API_SECRET;

if (!apiKey || !apiSecret) {
    console.error(
        '缺少 AMO 签名凭据：请先设置环境变量 JWT_ISSUER（api key）与 JWT_SECRET（secret）。\n' +
        '可在 addons.mozilla.org/developers 的「Web extension 版本」页面生成。',
    );
    process.exit(1);
}

const args = [
    'sign',
    '--source-dir', path.join(root, '.output', 'QZoneExport-firefox-mv3'),
    '--artifacts-dir', path.join(root, '.output', 'signed'),
    '--channel', 'unlisted',
    '--api-key', apiKey,
    '--api-secret', apiSecret,
    '--no-input',
];

console.log('> web-ext ' + args.join(' '));
const child = spawn(process.execPath, [webExtPath, ...args], { cwd: root, stdio: 'inherit' });
child.once('error', (err) => {
    console.error('启动 web-ext 失败：', err);
    process.exit(1);
});
child.once('exit', (code) => process.exit(code ?? 1));