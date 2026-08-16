#!/usr/bin/env node
/**
 * Pre-renders a unique, self-canonical static HTML page for every article and
 * case study, so search engines index each one instead of collapsing the
 * client-rendered `article.html?slug=` / `case-study.html?id=` query URLs into
 * a single "Alternative page with proper canonical tag" duplicate.
 *
 * Output:
 *   articles/<slug>/index.html   (from article.html template)
 *   work/<slug>/index.html       (from case-study.html template)
 *
 * Each generated page:
 *   - Adds <base href="https://remkovermeulen.com/"> so the deep path still
 *     resolves the template's relative asset/data/nav references from the root.
 *   - Bakes real <title>, description, OG/Twitter and a SELF-referencing
 *     canonical into the raw HTML (unique bytes per URL, indexable without JS).
 *   - Bakes the article/case-study text into the page for crawlers.
 *   - Sets window.__SLUG__ / window.__ID__ so the existing template JS renders
 *     the full designed layout (TOC, sections) for human visitors.
 *
 * Legacy /post/<slug>/ redirect stubs are repointed to /articles/<slug>/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = 'https://remkovermeulen.com';
const DEFAULT_IMG = 'https://remkovermeulen.com/assets/remko.jpg';

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Replace an exact substring once; throw if the template drifted so we notice.
function replaceOnce(html, find, repl, label) {
  const i = html.indexOf(find);
  if (i === -1) throw new Error(`Template placeholder not found (${label}): ${find.slice(0, 60)}`);
  return html.slice(0, i) + repl + html.slice(i + find.length);
}

function withBase(html) {
  return replaceOnce(html, '<head>', `<head>\n<base href="${BASE}/">`, '<head>');
}

function fillMeta(html, { title, desc, image, url, titleTag }) {
  const t = escAttr(title);
  const d = escAttr(desc);
  const img = escAttr(image || DEFAULT_IMG);
  html = replaceOnce(html, titleTag, `<title>${escText(title)} — Remko Vermeulen</title>`, 'title');
  html = replaceOnce(html, '<meta name="description" content="">', `<meta name="description" content="${d}">`, 'description');
  html = replaceOnce(html, '<meta property="og:title" content="">', `<meta property="og:title" content="${t} — Remko Vermeulen">`, 'og:title');
  html = replaceOnce(html, '<meta property="og:description" content="">', `<meta property="og:description" content="${d}">`, 'og:description');
  html = replaceOnce(html, '<meta property="og:url" content="">', `<meta property="og:url" content="${escAttr(url)}">`, 'og:url');
  html = replaceOnce(html, '<meta name="twitter:title" content="">', `<meta name="twitter:title" content="${t} — Remko Vermeulen">`, 'twitter:title');
  html = replaceOnce(html, '<meta name="twitter:description" content="">', `<meta name="twitter:description" content="${d}">`, 'twitter:description');
  html = replaceOnce(html, '<link rel="canonical" href="">', `<link rel="canonical" href="${escAttr(url)}">`, 'canonical');
  // OG/Twitter images default to remko.jpg in the template; override when a real cover exists.
  if (image) {
    html = html.split('<meta property="og:image" content="' + DEFAULT_IMG + '">').join('<meta property="og:image" content="' + img + '">');
    html = html.split('<meta name="twitter:image" content="' + DEFAULT_IMG + '">').join('<meta name="twitter:image" content="' + img + '">');
  }
  return html;
}

function writePage(relDir, html) {
  const dir = path.join(ROOT, relDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

function generateArticles(template) {
  const articles = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'articles.json'), 'utf8'));
  const seen = new Set();
  let count = 0;
  for (const meta of articles) {
    if (!meta.notionId) continue; // external links have no local page
    const slug = slugify(meta.title);
    if (seen.has(slug)) { console.warn(`  ⚠ duplicate article slug, skipping: ${slug}`); continue; }
    seen.add(slug);

    const detailPath = path.join(ROOT, 'data', 'articles', meta.notionId + '.json');
    if (!fs.existsSync(detailPath)) { console.warn(`  ⚠ missing article detail: ${meta.notionId}`); continue; }
    const article = JSON.parse(fs.readFileSync(detailPath, 'utf8'));

    const url = `${BASE}/articles/${slug}/`;
    const desc = article.summary || article.lede || stripHtml(article.content).slice(0, 160);
    const baked =
      `<article class="baked-content">` +
      `<h1>${escText(article.title)}</h1>` +
      (article.content || `<p>${escText(desc)}</p>`) +
      `</article>`;

    let html = withBase(template);
    html = fillMeta(html, { title: article.title, desc, image: article.coverImage, url, titleTag: '<title>Article — Remko Vermeulen</title>' });
    html = replaceOnce(
      html,
      '<main class="container" id="main-content">\n  <div class="art-loading" id="art-loading">Loading…</div>\n</main>',
      `<script>window.__SLUG__ = ${JSON.stringify(slug)};</script>\n<main class="container" id="main-content">\n${baked}\n</main>`,
      'article main'
    );
    writePage(path.join('articles', slug), html);
    count++;
  }
  console.log(`  ✓ articles: ${count} pages under /articles/`);
  return seen;
}

function generateProjects(template) {
  const projects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'projects.json'), 'utf8'));
  const seen = new Set();
  let count = 0;
  for (const meta of projects) {
    if (!meta.notionId) continue;
    const slug = slugify(meta.title);
    if (seen.has(slug)) { console.warn(`  ⚠ duplicate project slug, skipping: ${slug}`); continue; }
    seen.add(slug);

    const detailPath = path.join(ROOT, 'data', 'projects', meta.notionId + '.json');
    if (!fs.existsSync(detailPath)) { console.warn(`  ⚠ missing project detail: ${meta.notionId}`); continue; }
    const proj = JSON.parse(fs.readFileSync(detailPath, 'utf8'));

    const url = `${BASE}/work/${slug}/`;
    const firstBody = proj.sections && proj.sections[0] ? stripHtml(proj.sections[0].body) : '';
    const desc = proj.description || firstBody.slice(0, 160) || proj.lede || '';
    const sectionsHtml = (proj.sections || []).map(s =>
      (s.heading ? `<h2>${escText(s.heading)}</h2>` : '') + (s.body || '')
    ).join('\n');
    const baked =
      `<article class="baked-content">` +
      `<h1>${escText(proj.title)}</h1>` +
      (proj.lede ? `<p>${escText(proj.lede)}</p>` : '') +
      sectionsHtml +
      `</article>`;
    const image = proj.coverImage ? (proj.coverImage.startsWith('http') ? proj.coverImage : `${BASE}/${proj.coverImage}`) : '';

    let html = withBase(template);
    html = fillMeta(html, { title: proj.title, desc, image, url, titleTag: '<title>Case Study — Remko Vermeulen</title>' });
    html = replaceOnce(
      html,
      '<main class="container" id="cs-main">\n  <div class="cs-loading">Loading…</div>\n</main>',
      `<script>window.__ID__ = ${JSON.stringify(meta.notionId)};</script>\n<main class="container" id="cs-main">\n${baked}\n</main>`,
      'case-study main'
    );
    writePage(path.join('work', slug), html);
    count++;
  }
  console.log(`  ✓ case studies: ${count} pages under /work/`);
  return seen;
}

// Repoint legacy /post/<slug>/ redirect stubs to the new /articles/<slug>/ URL.
function fixPostStubs(articleSlugs) {
  const postDir = path.join(ROOT, 'post');
  if (!fs.existsSync(postDir)) return;
  const slugs = [...articleSlugs];
  let fixed = 0, removed = 0;
  for (const folder of fs.readdirSync(postDir)) {
    const idxPath = path.join(postDir, folder, 'index.html');
    if (!fs.existsSync(idxPath)) continue;
    const cur = fs.readFileSync(idxPath, 'utf8');

    let target = null;
    const m = cur.match(/article\.html\?slug=([a-z0-9-]+)/i);
    if (m && articleSlugs.has(m[1])) target = m[1];
    if (!target && articleSlugs.has(folder)) target = folder;
    if (!target) target = slugs.find(s => s.startsWith(folder) || folder.startsWith(s) || s.includes(folder) || folder.includes(s));

    if (!target) {
      fs.rmSync(path.join(postDir, folder), { recursive: true, force: true });
      removed++;
      continue;
    }
    const dest = `${BASE}/articles/${target}/`;
    const stub =
      `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n` +
      `<link rel="canonical" href="${dest}">\n` +
      `<meta http-equiv="refresh" content="0; url=${dest}">\n` +
      `<title>Redirecting…</title>\n` +
      `<script>location.replace("${dest}");</script>\n` +
      `</head>\n<body><p>Redirecting to <a href="${dest}">this article</a>…</p></body>\n</html>\n`;
    fs.writeFileSync(idxPath, stub);
    fixed++;
  }
  console.log(`  ✓ /post/ stubs: ${fixed} repointed, ${removed} removed`);
}

function generateAll() {
  console.log('Generating static article & case-study pages…');
  const articleTpl = fs.readFileSync(path.join(ROOT, 'article.html'), 'utf8');
  const projectTpl = fs.readFileSync(path.join(ROOT, 'case-study.html'), 'utf8');
  const articleSlugs = generateArticles(articleTpl);
  generateProjects(projectTpl);
  fixPostStubs(articleSlugs);
}

module.exports = { generateAll, slugify };

if (require.main === module) generateAll();
