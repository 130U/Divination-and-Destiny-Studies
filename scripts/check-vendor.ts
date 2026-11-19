import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(readFileSync(new URL('../vendor/zhenyi/SOURCE_MANIFEST.json', import.meta.url), 'utf8')) as { revision: string; files: { local: string; sha256: string; upstreamGitBlob: string; bytes: number }[] };
if (manifest.revision !== '383a726437a81db2b87eed517ef5e6ccd30b7bd4') throw new Error('Unexpected upstream revision.');
for (const entry of manifest.files) {
  if (!entry.local.startsWith('vendor/zhenyi/') || entry.local.includes('..')) throw new Error('Invalid vendor path.');
  const bytes = readFileSync(new URL('../' + entry.local, import.meta.url));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || sha256 !== entry.sha256 || gitBlob !== entry.upstreamGitBlob) throw new Error(`Vendor integrity mismatch: ${entry.local}`);
}
console.log(`Verified ${manifest.files.length} upstream files against pinned Git blob and SHA-256 hashes.`);
