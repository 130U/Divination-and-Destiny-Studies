import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url), output = new URL('dist/', root);
await mkdir(output, { recursive: true });
const allowedAssets = new Set(['index.html', 'app.js', 'styles.css', 'browser.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES.txt', '.nojekyll']);
if ((await readdir(output)).some(name => !allowedAssets.has(name))) throw new Error('Unexpected files in dist. Build stopped before publication; use a clean output directory.');
await build({
  entryPoints: [fileURLToPath(new URL('src/browser.ts', root))],
  outfile: fileURLToPath(new URL('browser.js', output)),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true,
  legalComments: 'eof', metafile: true,
  define: { 'process.env': '{}' },
});
const html = (await readFile(new URL('public/index.html', root), 'utf8'))
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-runtime="browser">')
  .replace('href="/styles.css"', 'href="./styles.css"')
  .replace('src="/app.js"', 'src="./app.js"')
  .replace('<meta name="color-scheme"', '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; connect-src \'self\' https://api.deepseek.com; img-src \'self\' data:; object-src \'none\'; base-uri \'none\'; form-action \'none\'"><meta name="referrer" content="no-referrer"><meta name="color-scheme"');
await writeFile(new URL('index.html', output), html);
for (const asset of ['app.js', 'styles.css']) await copyFile(new URL('public/' + asset, root), new URL(asset, output));
for (const asset of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await copyFile(new URL(asset, root), new URL(asset, output));
const thirdPartyLicenses = await Promise.all(['vendor/zhenyi/LICENSE', 'node_modules/@noble/hashes/LICENSE'].map(path => readFile(new URL(path, root), 'utf8')));
await writeFile(new URL('THIRD_PARTY_LICENSES.txt', output), thirdPartyLicenses.join('\n\n---\n\n'));
await writeFile(new URL('.nojekyll', output), '');
const bundle = await readFile(new URL('browser.js', output), 'utf8');
if (bundle.includes('node:') || /sk-[a-zA-Z0-9_-]{24,}/.test(bundle)) throw new Error('Browser artifact contains an unexpected Node import or credential-like value.');
console.log('Built browser-only app. No environment files or private reports copied.');
