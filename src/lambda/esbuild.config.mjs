import { build } from "esbuild";
import { readdirSync, createWriteStream } from "fs";
import { createGzip } from "zlib";
import archiver from "archiver";
import { join } from "path";

const functionDirs = readdirSync(".", { withFileTypes: true })
  .filter((d) => d.isDirectory() && !["shared", "node_modules", "dist"].includes(d.name))
  .map((d) => d.name);

// esbuild でバンドル
await Promise.all(
  functionDirs.map((fn) =>
    build({
      entryPoints: [`${fn}/index.ts`],
      bundle: true,
      platform: "node",
      target: "node22",
      outdir: `dist/${fn}`,
      external: [],
      minify: false,
      sourcemap: false,
    })
  )
);

// 各関数ディレクトリを zip に固める
async function zip(fn) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(`dist/${fn}/index.zip`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", reject);
    output.on("close", resolve);
    archive.pipe(output);
    archive.file(`dist/${fn}/index.js`, { name: "index.js" });
    archive.finalize();
  });
}

await Promise.all(functionDirs.map(zip));

console.log("Build complete:", functionDirs.join(", "));
