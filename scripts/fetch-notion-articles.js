#!/usr/bin/env node
// Fetches published articles and projects from Notion, writes:
//   data/articles.json          — metadata list for card grids
//   data/articles/{id}.json     — full content per article
//   data/projects.json          — metadata list for project grids
//   data/projects/{id}.json     — full content per project
//   data/config.json            — runtime config (Brandfetch key etc.)
// Requires NOTION_TOKEN env var and Node 18+

const fs = require('fs');
const path = require('path');

const ARTICLES_DB = 'f04c2f670a3f4239accf95486aa5336d';
const PROJECTS_DB = 'cdc9f0e38efc478ab9bc6bd562c82454';
const TOKEN = process.env.NOTION_TOKEN;
const BRANDFETCH_KEY = process.env.BRANDFETCH_KEY || '';

if (!TOKEN) { console.error('NOTION_TOKEN is not set'); process.exit(1); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

const SECTOR_IMAGES = {
  SaaS:       'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=80',
  PropTech:   'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1200&q=80',
  Health:     'https://images.unsplash.com/photo-1518152006812-edab29b069ac?w=1200&q=80',
  Telco:      'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=1200&q=80',
  Media:      'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&q=80',
  Automotive: 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=1200&q=80',
  Education:  'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1200&q=80',
  Finance:    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80',
};

async function notionRequest(method, p, body, attempt = 0) {
  const opts = { method, headers: HEADERS };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`https://api.notion.com/v1${p}`, opts);
  if ((res.status === 502 || res.status === 503 || res.status === 429) && attempt < 4) {
    const wait = (res.status === 429 ? 60 : 2 ** attempt) * 1000;
    await new Promise(r => setTimeout(r, wait));
    return notionRequest(method, p, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`Notion ${method} ${p} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionGet(p)       { return notionRequest('GET',  p); }
async function notionPost(p, body) { return notionRequest('POST', p, body); }

function extractText(prop) {
  if (!prop) return '';
  if (prop.type === 'title')     return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function richTextToHtml(richText) {
  return (richText || []).map(rt => {
    let t = rt.plain_text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (rt.annotations?.bold)          t = `<strong>${t}</strong>`;
    if (rt.annotations?.italic)        t = `<em>${t}</em>`;
    if (rt.annotations?.code)          t = `<code>${t}</code>`;
    if (rt.annotations?.strikethrough) t = `<del>${t}</del>`;
    if (rt.href) t = `<a href="${rt.href}" target="_blank" rel="noopener">${t}</a>`;
    return t;
  }).join('');
}

function blocksToHtml(blocks) {
  const parts = [];
  let inUl = false, inOl = false;

  for (const block of blocks) {
    if (block.type !== 'bulleted_list_item' && inUl)  { parts.push('</ul>'); inUl = false; }
    if (block.type !== 'numbered_list_item' && inOl)  { parts.push('</ol>'); inOl = false; }

    switch (block.type) {
      case 'paragraph': {
        const t = richTextToHtml(block.paragraph.rich_text);
        if (t.trim()) parts.push(`<p>${t}</p>`);
        break;
      }
      case 'heading_1': parts.push(`<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>`); break;
      case 'heading_2': parts.push(`<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>`); break;
      case 'heading_3': parts.push(`<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>`); break;
      case 'bulleted_list_item':
        if (!inUl) { parts.push('<ul>'); inUl = true; }
        parts.push(`<li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li>`); break;
      case 'numbered_list_item':
        if (!inOl) { parts.push('<ol>'); inOl = true; }
        parts.push(`<li>${richTextToHtml(block.numbered_list_item.rich_text)}</li>`); break;
      case 'quote':
        parts.push(`<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`); break;
      case 'divider':  parts.push('<hr>'); break;
      case 'callout':
        parts.push(`<div class="callout">${richTextToHtml(block.callout.rich_text)}</div>`); break;
    }
  }

  if (inUl) parts.push('</ul>');
  if (inOl) parts.push('</ol>');
  return parts.join('\n');
}

// Split blocks at H2 boundaries into sections array
function blocksToSections(blocks) {
  const sections = [];
  let current = null;
  let bodyBlocks = [];

  function flush() {
    if (current) {
      sections.push({ title: current, body: blocksToHtml(bodyBlocks) });
    }
  }

  for (const block of blocks) {
    if (block.type === 'heading_2') {
      flush();
      current = richTextToHtml(block.heading_2.rich_text).replace(/<[^>]+>/g, '');
      bodyBlocks = [];
    } else if (current) {
      bodyBlocks.push(block);
    }
  }
  flush();
  return sections;
}

// Extract plain text from a section body's first paragraph/list for sidebar meta
function plainFromBody(body) {
  return body.replace(/<[^>]+>/g, '').trim();
}

async function fetchAllBlocks(pageId) {
  const all = [];
  let cursor;
  do {
    const qs = cursor ? `?start_cursor=${cursor}` : '';
    const data = await notionGet(`/blocks/${pageId}/children${qs}`);
    all.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return all;
}

async function fetchArticles() {
  console.log('\nFetching articles…');
  const allPages = [];
  let cursor;
  do {
    const body = {
      filter: { property: 'Status', select: { equals: 'Published' } },
      sorts: [{ property: 'Published Date', direction: 'descending' }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/databases/${ARTICLES_DB}/query`, body);
    allPages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const metaList = [];
  const articlesDir = path.join(__dirname, '..', 'data', 'articles');
  fs.mkdirSync(articlesDir, { recursive: true });

  for (const page of allPages) {
    const p = page.properties;
    const dateStr = p['Published Date']?.date?.start ?? null;
    const year = dateStr ? new Date(dateStr).getFullYear().toString() : '';
    const tags = (p['Tags']?.multi_select || []).map(t => t.name);

    const meta = {
      notionId: page.id,
      title: extractText(p['Title']),
      category: p['Category']?.select?.name ?? '',
      year,
      readingTime: p['Reading Time']?.number ?? null,
      url: p['Article URL']?.url ?? page.url,
    };
    if (!meta.title) continue;
    metaList.push(meta);

    const blocks = await fetchAllBlocks(page.id);
    const content = blocksToHtml(blocks);
    fs.writeFileSync(
      path.join(articlesDir, `${page.id}.json`),
      JSON.stringify({ ...meta, tags, content }, null, 2)
    );
    console.log(`  ✓ ${meta.title}`);
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'articles.json'),
    JSON.stringify(metaList, null, 2)
  );
  console.log(`\nWrote ${metaList.length} articles`);
}

async function fetchProjects() {
  console.log('\nFetching projects…');
  const allPages = [];
  let cursor;
  do {
    const body = {
      filter: { property: 'Status', select: { equals: 'Live' } },
      sorts: [{ property: 'Year', direction: 'descending' }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/databases/${PROJECTS_DB}/query`, body);
    allPages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const metaList = [];
  const projectsDir = path.join(__dirname, '..', 'data', 'projects');
  fs.mkdirSync(projectsDir, { recursive: true });

  for (const page of allPages) {
    const p = page.properties;
    const title = extractText(p['Name']);
    if (!title) continue;

    const sector      = p['Sector']?.select?.name ?? '';
    const status      = p['Status']?.select?.name ?? '';
    const year        = p['Year']?.number ?? null;
    const tags        = (p['Tags']?.multi_select || []).map(t => t.name);
    const metricsRaw  = extractText(p['Metrics']);
    const logoDomain  = extractText(p['Logo Domain']);
    const description = extractText(p['Description']);
    const coverImage = SECTOR_IMAGES[sector] || SECTOR_IMAGES.SaaS;

    // Fetch page blocks and split into sections
    const blocks = await fetchAllBlocks(page.id);
    const sections = blocksToSections(blocks);

    // Extract sidebar fields from sections
    let role = '', timeline = '', partners = [];
    for (const sec of sections) {
      if (sec.title === 'Role') {
        const raw = plainFromBody(sec.body);
        const dash = raw.indexOf('—');
        if (dash !== -1) {
          role     = raw.slice(0, dash).trim();
          timeline = raw.slice(dash + 1).trim();
        } else {
          role = raw;
        }
      }
      if (sec.title === 'Partners') {
        partners = plainFromBody(sec.body).split('·').map(s => s.trim()).filter(Boolean);
      }
    }

    // Parse metrics from the Metrics property (semicolon-separated)
    const metrics = metricsRaw
      ? metricsRaw.split(';').map(m => {
          const clean = m.trim();
          const match = clean.match(/^([\d€$£%+×.M+]+)\s+(.+)$/);
          return match
            ? { value: match[1], label: match[2] }
            : { value: '', label: clean };
        }).filter(m => m.label)
      : [];

    // Use first non-Role, non-Partners section as lede source
    const overviewSec = sections.find(s => s.title === 'Overview');
    const lede = overviewSec
      ? plainFromBody(overviewSec.body).replace(/\n+/g, ' ').trim()
      : '';

    // Filter out Role/Partners from displayed sections (they live in sidebar)
    const displaySections = sections.filter(s => s.title !== 'Role' && s.title !== 'Partners');

    const meta = { notionId: page.id, title, sector, status, year, tags, lede, description, coverImage, metrics, logoDomain };
    metaList.push(meta);

    fs.writeFileSync(
      path.join(projectsDir, `${page.id}.json`),
      JSON.stringify({
        id: page.id, title, sector, status, year, tags, lede, description, coverImage,
        role, timeline, partners, metrics, logoDomain, sections: displaySections,
      }, null, 2)
    );
    console.log(`  ✓ ${title}`);
  }

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'projects.json'),
    JSON.stringify(metaList, null, 2)
  );
  console.log(`\nWrote ${metaList.length} projects`);
}

async function main() {
  await fetchArticles();
  await fetchProjects();

  // Write runtime config for the static site
  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'config.json'),
    JSON.stringify({ brandfetchKey: BRANDFETCH_KEY }, null, 2)
  );
  console.log('\nWrote data/config.json');
}

main().catch(err => { console.error(err); process.exit(1); });
