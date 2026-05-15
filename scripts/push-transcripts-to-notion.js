#!/usr/bin/env node
// Pushes YouTube transcript content back to Notion for matched articles.
// For each article with contentSource='youtube-transcript':
//   1. Clears all existing child blocks on the Notion page
//   2. Appends transcript as paragraph blocks (batched, 100 per request)
// Requires NOTION_TOKEN env var and Node 18+

const fs   = require('fs');
const path = require('path');

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) { console.error('NOTION_TOKEN is not set'); process.exit(1); }

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
};

async function notionReq(method, p, body) {
  const res = await fetch(`https://api.notion.com/v1${p}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${method} ${p} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// Strip HTML tags and decode basic entities
function htmlToText(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Extract <p> paragraph texts from HTML content
function extractParagraphs(html) {
  const matches = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)];
  return matches.map(m => htmlToText(m[1])).filter(Boolean);
}

// Build a Notion paragraph block from plain text (max 2000 chars per block)
function paragraphBlock(text) {
  // Notion rich_text items max 2000 chars each
  const chunks = [];
  for (let i = 0; i < text.length; i += 2000) {
    chunks.push({ type: 'text', text: { content: text.slice(i, i + 2000) } });
  }
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: chunks } };
}

async function clearPageBlocks(pageId) {
  let cursor;
  let deleted = 0;
  do {
    const qs = cursor ? `?start_cursor=${cursor}` : '';
    const data = await notionReq('GET', `/blocks/${pageId}/children${qs}`);
    for (const block of data.results) {
      await notionReq('DELETE', `/blocks/${block.id}`);
      deleted++;
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return deleted;
}

async function appendBlocks(pageId, blocks) {
  // Notion allows max 100 blocks per append request
  for (let i = 0; i < blocks.length; i += 100) {
    await notionReq('PATCH', `/blocks/${pageId}/children`, {
      children: blocks.slice(i, i + 100),
    });
  }
}

async function main() {
  const articlesDir = path.join(__dirname, '..', 'data', 'articles');
  const files = fs.readdirSync(articlesDir);

  for (const fname of files) {
    const fpath = path.join(articlesDir, fname);
    let article;
    try { article = JSON.parse(fs.readFileSync(fpath, 'utf8')); }
    catch { continue; }

    if (article.contentSource !== 'youtube-transcript') continue;

    console.log(`\nUpdating Notion for: ${article.title}`);
    console.log(`  Page ID: ${article.notionId}`);

    const paragraphs = extractParagraphs(article.content || '');
    if (!paragraphs.length) { console.log('  No paragraphs found, skipping'); continue; }

    // Clear existing blocks
    const deleted = await clearPageBlocks(article.notionId);
    console.log(`  Cleared ${deleted} existing block(s)`);

    // Append transcript as paragraph blocks
    const blocks = paragraphs.map(paragraphBlock);
    await appendBlocks(article.notionId, blocks);
    console.log(`  Appended ${blocks.length} paragraph block(s)`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
