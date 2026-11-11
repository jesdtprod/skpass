// Builds the static Tailwind CSS each page needs, replacing the Tailwind CDN script.
//
// Why: the CDN script is a 420 KB compiler that runs in the browser on every page load and
// watches the DOM afterwards. That blocks rendering and makes the page feel heavy and laggy.
// The same utilities compiled ahead of time are ~30-60 KB of plain CSS.
//
// Each page keeps its own colours/fonts: the inline `tailwind.config = {...}` block is read from
// the page itself, so the output matches what the CDN produced. Run it again whenever you add or
// change Tailwind classes in a page or in the scripts that create elements:
//
//   cd <any empty folder>
//   npm i tailwindcss@3.4.17 @tailwindcss/forms@0.5.10 @tailwindcss/container-queries@0.1.1
//   TW_DIR=<that folder> node <repo>/scripts/build-tailwind.mjs
//
// Output: web/css/tw/<page>.css (commit it).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tw = path.resolve(process.env.TW_DIR ?? process.cwd());
const require = createRequire(path.join(tw, "x.js"));
const bin = path.join(tw, "node_modules", ".bin", process.platform === "win32" ? "tailwindcss.cmd" : "tailwindcss");

const PAGES = {
  home: "web/index.html",
  register: "web/register/index.html",
  find: "web/find/index.html",
  login: "web/login/index.html",
  "my-qr": "web/my-qr/index.html",
  admin: "web/admin/index.html",
};
// Scripts that add classes at run time must be scanned too.
const SCRIPTS = ["web/js/*.js", "web/js/admin/*.js"];

const out = path.join(repo, "web/css/tw");
fs.mkdirSync(out, { recursive: true });
const work = fs.mkdtempSync(path.join(tw, "build-"));
fs.writeFileSync(path.join(work, "in.css"), "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");

for (const [name, rel] of Object.entries(PAGES)) {
  const html = fs.readFileSync(path.join(repo, rel), "utf8");
  const m = html.match(/tailwind\.config\s*=\s*(\{[\s\S]*?\n\s*\});?\s*<\/script>/);
  const inline = m ? new Function(`return (${m[1]})`)() : {};
  const config = {
    ...inline,
    content: [path.join(repo, rel), ...SCRIPTS.map((g) => path.join(repo, g))],
    plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
  };
  const cfgPath = path.join(work, `${name}.config.cjs`);
  fs.writeFileSync(
    cfgPath,
    `const c = ${JSON.stringify({ ...config, plugins: undefined })};\n` +
      `c.plugins = [require(${JSON.stringify(require.resolve("@tailwindcss/forms"))}), require(${JSON.stringify(require.resolve("@tailwindcss/container-queries"))})];\nmodule.exports = c;\n`,
  );
  execFileSync(bin, ["-c", cfgPath, "-i", path.join(work, "in.css"), "-o", path.join(out, `${name}.css`), "--minify"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  console.log(name, Math.round(fs.statSync(path.join(out, `${name}.css`)).size / 1024) + " KB");
}
fs.rmSync(work, { recursive: true, force: true });
