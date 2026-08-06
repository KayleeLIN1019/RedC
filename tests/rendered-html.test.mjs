import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Rednote operations workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>红序｜小红书双业务运营与素材系统<\/title>/i);
  assert.match(html, />红序</);
  assert.match(html, />信息流矩阵</);
  assert.match(html, />个人 IP 运营</);
  assert.match(html, />素材中心</);
  assert.match(html, />发布草稿台</);
  assert.doesNotMatch(html, /Your site is taking shape|Starter Project/);
});

test("wires Baidu cloud materials to the local cache and draft workflow", async () => {
  const [page, materialCenter, runner, materialService, readme, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/material-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../runner/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../runner/baidu-materials.mjs", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(page, /id: "materials", label: "素材中心"/);
  assert.match(page, /<MaterialCenter/);
  assert.match(page, /addMaterialToDraft/);
  assert.match(materialCenter, /连接百度网盘/);
  assert.match(materialCenter, /截取并加入草稿/);
  assert.match(materialCenter, /百度网盘原件不会删除/);
  assert.match(runner, /\/api\/materials\/baidu\/callback/);
  assert.match(runner, /\/api\/materials\/cache/);
  assert.match(materialService, /openapi\.baidu\.com\/oauth\/2\.0\/authorize/);
  assert.match(materialService, /material-cache/);
  assert.match(materialService, /execFileAsync\("ffmpeg"/);
  assert.match(readme, /连接百度网盘素材库/);
  assert.match(envExample, /BAIDU_PAN_APP_KEY=/);
  assert.doesNotMatch(envExample, /BAIDU_PAN_APP_KEY=\S+/);
});
