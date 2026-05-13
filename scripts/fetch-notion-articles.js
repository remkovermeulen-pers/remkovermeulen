#!/usr/bin/env node
// Fetches published articles from Notion and writes data/articles.json
// Requires NOTION_TOKEN env var and Node 18+

const fs = require('fs');
const path = require('path');

const DB_ID = 'f04c2f670a3f4239accf95486aa5336d';
const TOKEN = process.env.NOTION_TOKEN;

if (!TOKEN) {
  console.error('NOTION_TOKEN is not set');
  process.exit(1);
}

async function queryDatabase(startCursor) {
  const body = {
    filter: { property: 'Status', select: { equals: 'Published' } },
    sorts: [{ property: 'Published Date', direction: 'descending' }],
    page_size: 100,
  };
  if (startCursor) body.start_cursor = startCursor;

  const res = await fetch(`https://api.notion.com/v1/databases/${DB_ID}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

function extractText(prop) {
  if (!prop) return '';
  if (prop.type === 'title') return prop.title.map(t => t.plain_text).join('');
  if (prop.type === 'rich_text') return prop.rich_text.map(t => t.plain_text).join('');
  return '';
}

async function main() {
  const allResults = [];
  let cursor;

  do {
    const data = await queryDatabase(cursor);
    allResults.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  const articles = allResults.map(page => {
    const p = page.properties;
    const dateStr = p['Published Date']?.date?.start ?? null;
    const year = dateStr ? new Date(dateStr).getFullYear().toString() : '';
    return {
      title: extractText(p['Title']),
      category: p['Category']?.select?.name ?? '',
      year,
      readingTime: p['Reading Time']?.number ?? null,
      url: p['Article URL']?.url ?? page.url,
    };
  }).filter(a => a.title);

  const out = path.join(__dirname, '..', 'data', 'articles.json');
  fs.writeFileSync(out, JSON.stringify(articles, null, 2));
  console.log(`Wrote ${articles.length} articles to data/articles.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
