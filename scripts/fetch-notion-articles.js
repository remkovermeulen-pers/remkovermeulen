#!/usr/bin/env node
// Fetches published articles from Notion, writes:
//   data/articles.json          — metadata list for card grids
//   data/articles/{id}.json     — full content per article
// Requires NOTION_TOKEN env var and Node 18+

const fs = require('fs');
const path = require('path');

const DB_ID = 'f04c2f670a3f4239accf95486aa5336d';
const TOKEN = process.env.NOTION_TOKEN;

if (!TOKEN) { console.error('NOTION_TOKEN is not set'); process.exit(1); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Notion GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

function extractText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

function richTextToHtml(richText) {
  return (richText || []).map(rt => {
    let t = rt.plain_text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (rt.annotations?.bold) t = `<strong>${t}</strong>`;
    if (rt.annotations?.italic) t = `<em>${t}</em>`;
    if (rt.annotations?.code) t = `<code>${t}</code>`;
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
    if (block.type !== 'numbered_list_item' && inOl) { parts.push('</ol>'); inOl = false; }

    switch (block.type) {
      case 'paragraph': {
        const t = richTextToHtml(block.paragraph.rich_text);
        if (t.trim()) parts.push(`<p>${t}</p>`);
        break;
      }
      case 'heading_1':
        parts.push(`<h1>${richTextToHtml(block.heading_1.rich_text)}</h1>`); break;
      case 'heading_2':
        parts.push(`<h2>${richTextToHtml(block.heading_2.rich_text)}</h2>`); break;
      case 'heading_3':
        parts.push(`<h3>${richTextToHtml(block.heading_3.rich_text)}</h3>`); break;
      case 'bulleted_list_item':
        if (!inUl) { parts.push('<ul>'); inUl = true; }
        parts.push(`<li>${richTextToHtml(block.bulleted_list_item.rich_text)}</li>`); break;
      case 'numbered_list_item':
        if (!inOl) { parts.push('<ol>'); inOl = true; }
        parts.push(`<li>${richTextToHtml(block.numbered_list_item.rich_text)}</li>`); break;
      case 'quote':
        parts.push(`<blockquote>${richTextToHtml(block.quote.rich_text)}</blockquote>`); break;
      case 'divider':
        parts.push('<hr>'); break;
      case 'callout':
        parts.push(`<div class="callout">${richTextToHtml(block.callout.rich_text)}</div>`); break;
    }
  }

  if (inUl) parts.push('</ul>');
  if (inOl) parts.push('</ol>');
  return parts.join('\n');
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

async function main() {
  // 1. Query published articles
  const allPages = [];
  let cursor;
  do {
    const body = {
      filter: { property: 'Status', select: { equals: 'Published' } },
      sorts: [{ property: 'Published Date', direction: 'descending' }],
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const data = await notionPost(`/databases/${DB_ID}/query`, body);
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

    // 2. Fetch page blocks and write per-article file
    const blocks = await fetchAllBlocks(page.id);
    const content = blocksToHtml(blocks);
    const articleFile = path.join(articlesDir, `${page.id}.json`);
    fs.writeFileSync(articleFile, JSON.stringify({ ...meta, tags, content }, null, 2));
    console.log(`  ✓ ${meta.title}`);
  }

  // 3. Write metadata list
  const out = path.join(__dirname, '..', 'data', 'articles.json');
  fs.writeFileSync(out, JSON.stringify(metaList, null, 2));
  console.log(`\nWrote ${metaList.length} articles`);
}

main().catch(err => { console.error(err); process.exit(1); });
