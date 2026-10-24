import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PREFIX = '/uploads/';

/** `pnpm dev`'s stand-in for Vercel Blob: files under public/uploads, which `astro dev` serves at /uploads/. */
export function localUploads(root = process.cwd()) {
  const dir = path.resolve(root, 'public', 'uploads');
  const file = (pathname: string) => {
    const out = path.resolve(dir, pathname);
    if (!out.startsWith(dir + path.sep)) throw new Error(`Not an upload path: ${pathname}`);
    return out;
  };
  const fileOf = (url: string) => {
    if (!url.startsWith(PREFIX)) throw new Error(`Not a local upload: ${url}`);
    return file(decodeURIComponent(url.slice(PREFIX.length)));
  };
  return {
    async put(pathname: string, body: Uint8Array): Promise<{ url: string }> {
      const out = file(pathname);
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, body);
      return { url: PREFIX + pathname.split('/').map(encodeURIComponent).join('/') };
    },
    del: async (url: string) => rm(fileOf(url), { force: true }),
    get: async (url: string): Promise<Uint8Array> => readFile(fileOf(url)),
  };
}
