import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localUploads } from './local-uploads';

test('localUploads: put writes under public/uploads and answers its /uploads/ URL; get reads it, del removes it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholaros-uploads-'));
  const uploads = localUploads(root);
  const { url } = await uploads.put('career/7/a b.png', Buffer.from('png'));
  assert.equal(url, '/uploads/career/7/a%20b.png');
  const file = path.join(root, 'public/uploads/career/7/a b.png');
  assert.equal(fs.readFileSync(file, 'utf8'), 'png');
  assert.equal(Buffer.from(await uploads.get(url)).toString(), 'png');
  await uploads.del(url);
  assert.equal(fs.existsSync(file), false);
});

test('localUploads: nothing outside public/uploads is written, read or deleted', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholaros-uploads-'));
  fs.writeFileSync(path.join(root, 'keep.txt'), 'x');
  const uploads = localUploads(root);
  await assert.rejects(uploads.put('../../keep.txt', Buffer.from('y')), /Not an upload path/);
  await assert.rejects(uploads.del('/uploads/%2e%2e/%2e%2e/keep.txt'), /Not an upload path/);
  await assert.rejects(uploads.get('https://x.public.blob.vercel-storage.com/a.png'), /Not a local upload/);
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'x');
});
