import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  return readFile(new URL("../dist/index.html", import.meta.url), "utf8");
}

test("builds the Sopilka application shell", async () => {
  const html = await render();
  assert.match(html, /Візуалізатор аплікатур хроматичної сопілки/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /assets\/index-[^"']+\.js/);
});

test("ships Ukrainian PWA and social metadata", async () => {
  const html = await render();
  assert.match(html, /lang="uk"/);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /og\.png/);
  assert.match(html, /Ноти й наочні аплікатури в одному записі/);
});
