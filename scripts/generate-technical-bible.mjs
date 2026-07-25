/**
 * Genera: docs/backup/WhatXia-Basic-Biblia-Tecnica-MVP-v1.0.pdf
 * Consolida docs/backup/*.md + arbol-proyecto.txt
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUP = path.join(ROOT, "docs", "backup");
const OUT_PDF = path.join(BACKUP, "WhatXia-Basic-Biblia-Tecnica-MVP-v1.0.pdf");
const OUT_HTML = path.join(BACKUP, "_bible-build.html");

const COMMIT_SHORT = "d8a65d7";
const COMMIT_FULL = "d8a65d7513906117aef52e89d87edd8e344a69ad";
const VERSION = "1.0.0";
const DOC_DATE = "24 de julio de 2026";

marked.setOptions({ gfm: true, breaks: false });

function read(rel) {
  return fs.readFileSync(path.join(BACKUP, rel), "utf8");
}

function stripFirstH1(md) {
  return md.replace(/^#\s+.*\n+/, "");
}

function mdToHtml(md) {
  return marked.parse(md);
}

function section(id, title, bodyHtml) {
  return `
<section class="chapter" id="${id}">
  <h1>${title}</h1>
  ${bodyHtml}
</section>`;
}

const execSummary = `
<p><strong>WhatXia Basic</strong> (repositorio <code>whatxia-mobility-mvp</code>) es el MVP de movilidad urbana por WhatsApp enfocado en <strong>Ibagué</strong>. Este documento consolida el backup integral ubicado en <code>docs/backup/</code> y constituye la <strong>Biblia Técnica MVP v1.0</strong>: referencia oficial para archivar, compartir y recuperar el sistema.</p>

<table>
  <thead><tr><th>Campo</th><th>Valor</th></tr></thead>
  <tbody>
    <tr><td>Proyecto</td><td>WhatXia Basic</td></tr>
    <tr><td>Documento</td><td>Biblia Técnica MVP v1.0</td></tr>
    <tr><td>Versión</td><td>${VERSION}</td></tr>
    <tr><td>Fecha</td><td>${DOC_DATE}</td></tr>
    <tr><td>Commit de referencia</td><td><code>${COMMIT_SHORT}</code> (<code>${COMMIT_FULL}</code>)</td></tr>
    <tr><td>Rama</td><td><code>main</code></td></tr>
    <tr><td>Repositorio</td><td>https://github.com/WhatXia/whatxia-mobility-mvp</td></tr>
    <tr><td>Base de datos</td><td>Supabase (29 migraciones, 001–029)</td></tr>
    <tr><td>Hosting</td><td>Vercel (Next.js 16)</td></tr>
    <tr><td>Canal</td><td>WhatsApp Cloud API (Meta)</td></tr>
    <tr><td>Estado</td><td><strong>Baseline para pruebas reales</strong></td></tr>
  </tbody>
</table>

<h2>Alcance de este backup</h2>
<ul>
  <li>Auditoría y documentación únicamente (sin alterar código de producto ni ejecutar migraciones en este sprint documental).</li>
  <li>Secretos: solo se documentan <em>nombres</em> de variables de entorno, nunca valores.</li>
  <li>Fuentes: <code>docs/backup/01</code> … <code>07</code>, <code>arbol-proyecto.txt</code> y metadatos Git del corte <code>${COMMIT_SHORT}</code>.</li>
</ul>

<h2>Contenido consolidado</h2>
<ol>
  <li>Estado del MVP</li>
  <li>Arquitectura y conocimiento funcional</li>
  <li>Repositorio, Vercel y Supabase (incl. 29 migraciones)</li>
  <li>Integración WhatsApp / Meta</li>
  <li>Reglas de negocio</li>
  <li>Árbol del proyecto</li>
  <li>Manual de recuperación</li>
  <li>Próximos pasos</li>
</ol>
`;

const architectureExtra = `
<p>El <strong>Core Agent</strong> es el orquestador único de entrada (<code>handleIncomingMessage</code>). No hay microservicios: un deploy Next.js en Vercel recibe el webhook y enruta por prioridad hacia Mobility, Dispatch, registro de conductores, túneles, taxímetro de prueba, etc.</p>
<pre class="diagram">Meta Webhook
  → verify + parse + normalize (voz)
  → Core Agent (handler)
      → tunnels / rating / cancellations / search
      → dispatch / driver menu / registration
      → taximeter test / booking (Mobility)
      → greeting / intent / fallback
  → WhatsApp client → usuario
  → Supabase · Google Maps · OpenAI (opcional)</pre>
<p><strong>Conversation Planner</strong> (concepto): máquina de estados en <code>conversation_sessions</code> + orden de evaluación del handler. <strong>Response Generator</strong> (concepto): plantillas determinísticas vía cliente WhatsApp (no LLM de negocio; Whisper solo convierte audio→texto).</p>
`;

// Extract business rules section from functional doc for dedicated chapter
const functionalMd = stripFirstH1(read("05-conocimiento-funcional.md"));
const rulesMatch = functionalMd.match(
  /## Reglas de negocio[\s\S]*?(?=\n## Decisiones de arquitectura)/,
);
const decisionsMatch = functionalMd.match(
  /## Decisiones de arquitectura[\s\S]*?(?=\n## Mapa rápido)/,
);
const rulesMd = rulesMatch
  ? rulesMatch[0]
  : "## Reglas de negocio\n\nVer capítulo de conocimiento funcional.";
const decisionsMd = decisionsMatch ? decisionsMatch[0] : "";

const estadoMd = stripFirstH1(read("06-estado-mvp.md"));
const proximosMatch = estadoMd.match(/## Próximos pasos[\s\S]*/);
const estadoSinProximos = proximosMatch
  ? estadoMd.replace(/## Próximos pasos[\s\S]*/, "").trim()
  : estadoMd;
const proximosMd = proximosMatch
  ? proximosMatch[0]
  : "## Próximos pasos\n\nVer estado del MVP.";

const treeText = read("arbol-proyecto.txt")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const chapters = [
  { id: "resumen", title: "1. Resumen ejecutivo", html: execSummary },
  {
    id: "estado",
    title: "2. Estado del MVP",
    html: mdToHtml(estadoSinProximos),
  },
  {
    id: "arquitectura",
    title: "3. Arquitectura",
    html: architectureExtra + mdToHtml(
      functionalMd
        .replace(/## Reglas de negocio[\s\S]*?(?=\n## Decisiones de arquitectura)/, "")
        .replace(/## Decisiones de arquitectura[\s\S]*?(?=\n## Mapa rápido)/, "")
        .split("## Arquitectura del Core Agent")[0]
        ? "## Arquitectura del Core Agent" +
          (functionalMd.split("## Arquitectura del Core Agent")[1] || "")
            .replace(/## Reglas de negocio[\s\S]*?(?=\n## Decisiones de arquitectura)/, "")
            .replace(/## Decisiones de arquitectura[\s\S]*?(?=\n## Mapa rápido)/, "")
            .split("## Mobility")[0] +
          "\n## Mobility" +
          ((functionalMd.split("## Mobility")[1] || "")
            .replace(/## Reglas de negocio[\s\S]*/s, "")
            .includes("## Dispatch")
            ? (functionalMd.split("## Mobility")[1] || "")
                .split("## Reglas de negocio")[0]
                .split("## Decisiones de arquitectura")[0]
            : (functionalMd.split("## Mobility")[1] || "").split("## Reglas de negocio")[0])
        : functionalMd,
    ),
  },
  {
    id: "repositorio",
    title: "4. Repositorio (GitHub)",
    html: mdToHtml(stripFirstH1(read("01-repositorio.md"))),
  },
  {
    id: "vercel",
    title: "5. Vercel",
    html: mdToHtml(stripFirstH1(read("02-vercel.md"))),
  },
  {
    id: "supabase",
    title: "6. Supabase",
    html: mdToHtml(stripFirstH1(read("03-supabase.md"))),
  },
  {
    id: "whatsapp",
    title: "7. Integración WhatsApp / Meta",
    html: mdToHtml(stripFirstH1(read("04-whatsapp-meta.md"))),
  },
  {
    id: "funcional",
    title: "8. Conocimiento funcional",
    html: mdToHtml(
      stripFirstH1(read("05-conocimiento-funcional.md"))
        .replace(/## Reglas de negocio[\s\S]*?(?=\n## Decisiones de arquitectura)/, "")
        .replace(/## Decisiones de arquitectura[\s\S]*?(?=\n## Mapa rápido)/, "\n"),
    ),
  },
  {
    id: "reglas",
    title: "9. Reglas de negocio y decisiones de arquitectura",
    html: mdToHtml(rulesMd + "\n\n" + decisionsMd),
  },
  {
    id: "arbol",
    title: "10. Árbol del proyecto",
    html: `<p>Inventario de rutas del repositorio (sin <code>node_modules</code>, <code>.git</code> ni <code>.next</code>).</p><pre class="tree">${treeText}</pre>`,
  },
  {
    id: "recuperacion",
    title: "11. Manual de recuperación",
    html: mdToHtml(stripFirstH1(read("07-manual-recuperacion.md"))),
  },
  {
    id: "proximos",
    title: "12. Próximos pasos",
    html: mdToHtml(proximosMd),
  },
];

// Simplify architecture chapter: use dedicated slice from functional doc
const archSource = stripFirstH1(read("05-conocimiento-funcional.md"));
const archBody =
  architectureExtra +
  mdToHtml(
    [
      archSource.match(/## Arquitectura del Core Agent[\s\S]*?(?=\n## Mobility)/)?.[0] || "",
      archSource.match(/## Mobility[\s\S]*?(?=\n## Dispatch)/)?.[0] || "",
      archSource.match(/## Dispatch[\s\S]*?(?=\n## Pricing)/)?.[0] || "",
      archSource.match(/## Pricing[\s\S]*?(?=\n## Registro)/)?.[0] || "",
      archSource.match(/## Mapa rápido[\s\S]*/)?.[0] || "",
    ].join("\n\n"),
  );
chapters[2].html = archBody;

const tocItems = chapters
  .map(
    (c, i) =>
      `<li><a href="#${c.id}"><span class="toc-num">${String(i + 1).padStart(2, "0")}</span> ${c.title.replace(/^\d+\.\s*/, "")}</a></li>`,
  )
  .join("\n");

const bodyChapters = chapters.map((c) => section(c.id, c.title, c.html)).join("\n");

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>WhatXia Basic — Biblia Técnica MVP v1.0</title>
<style>
  @page {
    size: A4;
    margin: 18mm 16mm 20mm 16mm;
  }
  :root {
    --ink: #14212b;
    --muted: #4a5a66;
    --line: #d5dde3;
    --accent: #0b6e4f;
    --accent-soft: #e8f5f0;
    --cover: #0f2a24;
  }
  * { box-sizing: border-box; }
  html { font-size: 10.5pt; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    line-height: 1.45;
    margin: 0;
  }
  a { color: var(--accent); text-decoration: none; }
  h1, h2, h3, h4 {
    font-family: Georgia, "Times New Roman", serif;
    color: var(--ink);
    page-break-after: avoid;
  }
  h1 {
    font-size: 1.55rem;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 0.35rem;
    margin: 0 0 1rem;
  }
  h2 { font-size: 1.2rem; margin-top: 1.4rem; color: #16352c; }
  h3 { font-size: 1.05rem; margin-top: 1.1rem; }
  p { margin: 0.55rem 0; }
  ul, ol { margin: 0.4rem 0 0.8rem 1.2rem; }
  li { margin: 0.2rem 0; }
  blockquote {
    margin: 0.8rem 0;
    padding: 0.6rem 0.9rem;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--muted);
  }
  code {
    font-family: Consolas, "Courier New", monospace;
    font-size: 0.88em;
    background: #f1f4f6;
    padding: 0.05em 0.3em;
    border-radius: 3px;
  }
  pre {
    background: #122029;
    color: #e8eef2;
    padding: 0.85rem 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.78rem;
    line-height: 1.35;
    page-break-inside: avoid;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  pre.tree, pre.diagram {
    background: #f7f9fa;
    color: var(--ink);
    border: 1px solid var(--line);
    white-space: pre-wrap;
    word-break: break-word;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8rem 0 1.1rem;
    font-size: 0.92em;
    page-break-inside: auto;
  }
  th, td {
    border: 1px solid var(--line);
    padding: 0.4rem 0.5rem;
    vertical-align: top;
    text-align: left;
  }
  th {
    background: var(--accent-soft);
    color: #16352c;
    font-weight: 600;
  }
  tr { page-break-inside: avoid; }

  .cover {
    page-break-after: always;
    min-height: 240mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 8mm 4mm;
    background:
      linear-gradient(165deg, #0f2a24 0%, #164a3c 48%, #1f6b52 100%);
    color: #f4faf7;
    border-radius: 4px;
  }
  .cover-brand {
    font-size: 0.85rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  .cover h1.cover-title {
    border: 0;
    color: #fff;
    font-size: 2.4rem;
    line-height: 1.15;
    margin: 1.5rem 0 0.6rem;
  }
  .cover .subtitle {
    font-size: 1.25rem;
    opacity: 0.95;
    margin-bottom: 2rem;
  }
  .cover-meta {
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    padding: 1.1rem 1.3rem;
    margin-top: 1rem;
  }
  .cover-meta dl {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.45rem 0.8rem;
    margin: 0;
  }
  .cover-meta dt { opacity: 0.75; }
  .cover-meta dd { margin: 0; font-weight: 600; }
  .cover-footer {
    margin-top: 2.5rem;
    font-size: 0.85rem;
    opacity: 0.8;
  }
  .badge {
    display: inline-block;
    margin-top: 1rem;
    padding: 0.35rem 0.75rem;
    border: 1px solid rgba(255,255,255,0.45);
    border-radius: 999px;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
  }

  .toc-page { page-break-after: always; }
  .toc-page h1 { margin-bottom: 1.2rem; }
  .toc-page ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .toc-page li {
    border-bottom: 1px dotted var(--line);
    padding: 0.55rem 0;
  }
  .toc-page a {
    color: var(--ink);
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
  }
  .toc-num {
    color: var(--accent);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .chapter {
    page-break-before: always;
  }
  .chapter:first-of-type { page-break-before: auto; }

  .doc-end {
    page-break-before: always;
    text-align: center;
    padding-top: 40mm;
    color: var(--muted);
  }
  .doc-end h2 {
    color: var(--accent);
    border: 0;
  }
</style>
</head>
<body>

<section class="cover">
  <div>
    <div class="cover-brand">WhatXia · Mobility</div>
    <h1 class="cover-title">WhatXia Basic</h1>
    <div class="subtitle">Biblia Técnica MVP v1.0</div>
    <div class="badge">Baseline para pruebas reales</div>
  </div>
  <div class="cover-meta">
    <dl>
      <dt>Proyecto</dt><dd>WhatXia Basic</dd>
      <dt>Documento</dt><dd>Biblia Técnica MVP v1.0</dd>
      <dt>Versión</dt><dd>${VERSION}</dd>
      <dt>Commit de referencia</dt><dd>${COMMIT_SHORT}</dd>
      <dt>Base de datos</dt><dd>Supabase (29 migraciones)</dd>
      <dt>Fecha</dt><dd>${DOC_DATE}</dd>
      <dt>Estado</dt><dd>Baseline para pruebas reales</dd>
      <dt>Clasificación</dt><dd>Respaldo técnico oficial · Uso interno</dd>
    </dl>
  </div>
  <div class="cover-footer">
    Consolidado desde <code>docs/backup/</code> · Repositorio WhatXia/whatxia-mobility-mvp · Canal WhatsApp Cloud API · Stack Next.js + Supabase + Vercel
  </div>
</section>

<section class="toc-page" id="toc">
  <h1>Tabla de contenido</h1>
  <ol>
    ${tocItems}
  </ol>
  <p style="margin-top:1.5rem;color:var(--muted);font-size:0.9rem;">
    La numeración de páginas aparece en el pie de cada hoja. Los enlaces de este índice corresponden a los capítulos del documento.
  </p>
</section>

${bodyChapters}

<section class="doc-end">
  <h2>Fin del documento</h2>
  <p>WhatXia Basic — Biblia Técnica MVP v${VERSION}</p>
  <p>Commit <code>${COMMIT_SHORT}</code> · Supabase 29 migraciones · ${DOC_DATE}</p>
  <p>Documento generado para archivo y recuperación del MVP.</p>
</section>

</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, "utf8");
console.log("HTML escrito:", OUT_HTML);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  const page = await browser.newPage();
  await page.goto("file://" + OUT_HTML.replace(/\\/g, "/"), {
    waitUntil: "networkidle0",
  });

  await page.pdf({
    path: OUT_PDF,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `
      <div style="width:100%;font-size:8px;color:#6a7a84;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif;">
        <span>WhatXia Basic — Biblia Técnica MVP v1.0</span>
        <span>Commit ${COMMIT_SHORT} · Confidencial interno</span>
      </div>`,
    footerTemplate: `
      <div style="width:100%;font-size:8px;color:#6a7a84;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif;">
        <span>Baseline para pruebas reales · Supabase 29 migraciones</span>
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>`,
    margin: {
      top: "18mm",
      bottom: "18mm",
      left: "14mm",
      right: "14mm",
    },
  });

  console.log("PDF generado:", OUT_PDF);
} finally {
  await browser.close();
}

// Limpiar HTML intermedio (opcional: conservar para depuración)
fs.unlinkSync(OUT_HTML);
console.log("Listo.");
