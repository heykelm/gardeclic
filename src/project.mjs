import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { upsertEnvFile } from "./envfile.mjs";

const LAYOUTS = [
  "src/app/layout.tsx",
  "src/app/layout.jsx",
  "src/app/layout.js",
  "app/layout.tsx",
  "app/layout.jsx",
  "app/layout.js",
];

const HTML_FILES = ["index.html", "public/index.html"];

export function snippetTag(origin, siteId) {
  const base = String(origin || "").replace(/\/$/, "") || "https://YOUR-INSTANCE";
  const site = siteId || "TON_ID";
  return `<script src="${base}/s.js" data-site="${site}"></script>`;
}

export async function detectProject(root) {
  const abs = path.resolve(root);
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(path.join(abs, "package.json"), "utf8"));
  } catch {
    pkg = {};
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let layout = null;
  for (const rel of LAYOUTS) {
    try {
      await readFile(path.join(abs, rel), "utf8");
      layout = rel;
      break;
    } catch {
      /* next */
    }
  }
  let html = null;
  for (const rel of HTML_FILES) {
    try {
      await readFile(path.join(abs, rel), "utf8");
      html = rel;
      break;
    } catch {
      /* next */
    }
  }
  const kind = layout ? "next-app" : html ? "html" : deps.next ? "next-app" : deps.vite ? "vite" : "unknown";
  const haystack = [layout, html].filter(Boolean);
  let hasSnippet = false;
  for (const rel of haystack) {
    const src = await readFile(path.join(abs, rel), "utf8");
    if (src.includes("/s.js") || src.includes("GardeClic")) {
      hasSnippet = true;
      break;
    }
  }
  return {
    root: abs,
    kind,
    layout,
    html,
    hasSnippet,
    name: pkg.name || path.basename(abs),
  };
}

function componentSource() {
  return `export function GardeClicSnippet() {
  const origin = process.env.NEXT_PUBLIC_GARDECLIC_ORIGIN;
  const site = process.env.NEXT_PUBLIC_GARDECLIC_SITE;
  if (!origin || !site) return null;
  const src = origin.replace(/\\/$/, "") + "/s.js?site=" + encodeURIComponent(site);
  return <script src={src} data-site={site} />;
}
`;
}

function relativeImport(fromFile, toFile) {
  let rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.replace(/\.tsx$|\.jsx$|\.js$/, "");
}

export async function installSnippet({ projectRoot, origin, siteId }) {
  const detected = await detectProject(projectRoot);
  const originClean = String(origin || "").replace(/\/$/, "");
  const site = String(siteId || "").trim();
  const steps = [];

  if (detected.kind === "next-app" && detected.layout) {
    const ext = detected.layout.endsWith(".tsx") ? ".tsx" : ".jsx";
    const componentRel = detected.layout.startsWith("src/")
      ? `src/components/GardeClicSnippet${ext}`
      : `components/GardeClicSnippet${ext}`;
    const componentAbs = path.join(detected.root, componentRel);
    await mkdir(path.dirname(componentAbs), { recursive: true });
    await writeFile(componentAbs, componentSource());
    steps.push(`wrote ${componentRel}`);

    const layoutAbs = path.join(detected.root, detected.layout);
    let layout = await readFile(layoutAbs, "utf8");
    if (!layout.includes("GardeClicSnippet") && !layout.includes("/s.js")) {
      const spec = relativeImport(detected.layout, componentRel);
      const importLine = `import { GardeClicSnippet } from "${spec}";`;
      if (!layout.includes(importLine)) {
        const imports = layout.match(/^(?:import[\s\S]*?;\n)+/m);
        layout = imports
          ? layout.replace(imports[0], `${imports[0]}${importLine}\n`)
          : `${importLine}\n${layout}`;
      }
      if (/<body[^>]*>/.test(layout)) {
        layout = layout.replace(/<body([^>]*)>/, `<body$1>\n        <GardeClicSnippet />`);
      }
      await writeFile(layoutAbs, layout);
      steps.push(`patched ${detected.layout}`);
    } else {
      steps.push(`${detected.layout} already has GardeClic`);
    }

    if (originClean && site) {
      await upsertEnvFile(path.join(detected.root, ".env.local"), {
        NEXT_PUBLIC_GARDECLIC_ORIGIN: originClean,
        NEXT_PUBLIC_GARDECLIC_SITE: site,
      });
      steps.push("set NEXT_PUBLIC_GARDECLIC_ORIGIN and NEXT_PUBLIC_GARDECLIC_SITE in .env.local");
    }
    return { ...detected, hasSnippet: true, steps, snippet: snippetTag(originClean, site) };
  }

  const htmlRel = detected.html;
  if (htmlRel && site) {
    const htmlAbs = path.join(detected.root, htmlRel);
    let html = await readFile(htmlAbs, "utf8");
    const tag = snippetTag(originClean, site);
    if (html.includes("/s.js") || html.includes("GardeClic")) {
      steps.push(`${htmlRel} already has the snippet`);
    } else if (html.includes("</head>")) {
      html = html.replace("</head>", `  ${tag}\n</head>`);
      await writeFile(htmlAbs, html);
      steps.push(`patched ${htmlRel}`);
    } else {
      html += `\n${tag}\n`;
      await writeFile(htmlAbs, html);
      steps.push(`appended snippet to ${htmlRel}`);
    }
    return { ...detected, hasSnippet: true, steps, snippet: tag };
  }

  return {
    ...detected,
    steps: [
      "Could not patch a layout automatically. Add this tag on the landing page:",
      snippetTag(originClean, site),
    ],
    snippet: snippetTag(originClean, site),
  };
}
