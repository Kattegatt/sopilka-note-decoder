import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const assets = (await readdir(new URL("../dist/assets/", import.meta.url)))
  .filter((name) => !name.endsWith(".map"))
  .map((name) => `assets/${name}`);
const manifest = JSON.stringify(assets);
await writeFile(new URL("../dist/offline-assets.json", import.meta.url), manifest);
const workerURL = new URL("../dist/sw.js", import.meta.url);
const worker = await readFile(workerURL, "utf8");
const version = createHash("sha256").update(manifest).update(worker).digest("hex").slice(0, 12);
await writeFile(workerURL, worker.replace('"sopilka-v7"', `"sopilka-v7-${version}"`));
