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

const YOUTUBE_CHANNEL_ID = 'UCsCKDRichUBYXNLAnWFugdw';

async function fetchYouTubeVideos() {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`);
    const xml = await res.text();
    const ids    = [...xml.matchAll(/<yt:videoId>([^<]+)<\/yt:videoId>/g)].map(m => m[1]);
    const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map(m => m[1]).slice(1);
    return ids.map((id, i) => ({ id, title: titles[i] || '' }));
  } catch (e) {
    console.warn('  YouTube RSS fetch failed:', e.message);
    return [];
  }
}

async function fetchTranscript(videoId) {
  try {
    // Fetch video page to get caption track URL
    const page = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' }
    }).then(r => r.text());

    const m = page.match(/"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]*)"/);
    if (!m) return null;
    const captionUrl = m[1].replace(/\\u0026/g, '&') + '&fmt=json3';

    const data = await fetch(captionUrl).then(r => r.json()).catch(() => null);
    if (!data?.events) return null;

    // Extract text segments and group into ~80-word paragraphs
    const segments = data.events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8 || '').join('').replace(/\[.*?\]/g, '').trim())
      .filter(Boolean);

    const paragraphs = [];
    let current = [], wordCount = 0;
    for (const seg of segments) {
      const words = seg.split(/\s+/);
      current.push(...words);
      wordCount += words.length;
      if (wordCount >= 80 && /[.!?]$/.test(seg)) {
        paragraphs.push(current.join(' '));
        current = []; wordCount = 0;
      }
    }
    if (current.length) paragraphs.push(current.join(' '));

    // Build HTML: group 3 paragraphs per block
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const blocks = [];
    for (let i = 0; i < paragraphs.length; i += 3) {
      blocks.push(paragraphs.slice(i, i+3).map(p => `<p>${esc(p)}</p>`).join('\n'));
    }
    return blocks.join('\n');
  } catch (e) {
    console.warn(`  Transcript fetch failed for ${videoId}:`, e.message);
    return null;
  }
}

function normalizeTitle(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchVideo(articleTitle, videos) {
  const na = normalizeTitle(articleTitle);
  for (const v of videos) {
    const nv = normalizeTitle(v.title);
    if (na === nv || na.includes(nv) || nv.includes(na)) return v;
    // Jaccard word overlap ≥ 0.5
    const wa = new Set(na.split(' ').filter(w => w.length > 3));
    const wv = new Set(nv.split(' ').filter(w => w.length > 3));
    const overlap = [...wa].filter(w => wv.has(w)).length;
    if (overlap / (new Set([...wa, ...wv]).size) >= 0.5) return v;
  }
  return null;
}

async function fetchArticles() {
  console.log('\nFetching YouTube videos…');
  const videos = await fetchYouTubeVideos();
  console.log(`  Found ${videos.length} videos`);
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

    // Read existing JSON early so we can preserve custom fields in meta (and articles.json)
    const existingPath = path.join(articlesDir, `${page.id}.json`);
    const existing = fs.existsSync(existingPath) ? JSON.parse(fs.readFileSync(existingPath, 'utf8')) : null;

    // Preserve coverImage and coverImagePosition — not Notion properties, always manually curated
    if (existing?.coverImage) meta.coverImage = existing.coverImage;
    if (existing?.coverImagePosition) meta.coverImagePosition = existing.coverImagePosition;

    const matched = matchVideo(meta.title, videos);
    if (matched) {
      meta.youtubeVideoId = matched.id;
      console.log(`  🎬 Matched "${meta.title}" → ${matched.id}`);
    } else if (existing?.youtubeVideoId) {
      // Preserve explicit youtubeVideoId when title-based auto-match fails
      meta.youtubeVideoId = existing.youtubeVideoId;
    }
    metaList.push(meta);

    // Preserve content for articles already written by Claude
    if (existing?.contentSource === 'claude-written') {
      fs.writeFileSync(existingPath, JSON.stringify({ ...existing, ...meta, tags }, null, 2));
      console.log(`  ✓ ${meta.title} (preserved claude-written content)`);
      continue;
    }

    const blocks = await fetchAllBlocks(page.id);
    let content = blocksToHtml(blocks);
    let contentSource = 'notion';

    // If a YouTube video matched, use its transcript as content
    if (matched) {
      const transcript = await fetchTranscript(matched.id);
      if (transcript) {
        content = transcript;
        contentSource = 'youtube-transcript';
        console.log(`    📝 Using transcript as content`);
      }
    }

    fs.writeFileSync(
      path.join(articlesDir, `${page.id}.json`),
      JSON.stringify({ ...meta, tags, content, contentSource }, null, 2)
    );
    console.log(`  ✓ ${meta.title}`);
  }

  // Append any manually-created articles (contentSource: 'manual') not in Notion
  const notionIds = new Set(metaList.map(m => m.notionId));
  for (const file of fs.readdirSync(articlesDir).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(articlesDir, file), 'utf8'));
      if (data.contentSource === 'manual' && !notionIds.has(data.notionId)) {
        const { content, contentSource, ...meta } = data;
        metaList.push(meta);
        console.log(`  + Manual article: ${data.title}`);
      }
    } catch (e) { /* skip malformed files */ }
  }
  // Re-sort by year descending so manual articles appear in the right position
  metaList.sort((a, b) => (b.year || '') > (a.year || '') ? 1 : -1);

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'articles.json'),
    JSON.stringify(metaList, null, 2)
  );
  console.log(`\nWrote ${metaList.length} articles`);
}

async function fetchOrgData() {
  // Fetch all pages from the Organisations database to build an id→{name,logo} map
  const ORGS_DB = '1ac1832bfd5b4f2ca15ada299623208b';
  const map = {};
  let cursor;
  try {
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const data = await notionPost(`/databases/${ORGS_DB}/query`, body);
      for (const page of data.results) {
        const p = page.properties;
        const titleProp = p['Name'] || p['Organisation'] || Object.values(p).find(x => x.type === 'title');
        const name = extractText(titleProp);
        const logo = extractText(p['Logo']);
        // Store under both hyphenated and plain-UUID keys to handle both formats
        const plainId = page.id.replace(/-/g, '');
        if (name) { map[page.id] = { name, logo }; map[plainId] = { name, logo }; }
      }
      cursor = data.has_more ? data.next_cursor : null;
    } while (cursor);
  } catch (e) {
    console.warn('  Could not fetch Organisations DB:', e.message);
  }
  return map;
}

async function fetchProjects() {
  console.log('\nFetching projects…');
  const orgData = await fetchOrgData();
  console.log(`  Loaded ${Object.keys(orgData).length} organisations`);
  const allPages = [];
  let cursor;
  do {
    const body = {
      filter: { property: 'Status', select: { equals: 'Live' } },
      sorts: [
        { property: 'Priority', direction: 'ascending' },
        { property: 'Year', direction: 'descending' },
      ],
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

    const sector        = p['Sector']?.select?.name ?? '';
    const status        = p['Status']?.select?.name ?? '';
    const year          = p['Year']?.number ?? null;
    const priority      = p['Priority']?.number ?? 999;
    const tags          = (p['Tags']?.multi_select || []).map(t => t.name);
    const metricsRaw    = extractText(p['Metrics']);
    const logoDomain    = extractText(p['Logo Domain']);
    const organisations = (p['Organisation']?.relation || [])
                            .map(r => orgData[r.id])
                            .filter(Boolean)
                            .map(o => ({ name: o.name, logo: o.logo || '' }));
    const description = extractText(p['Description']);

    // Read existing JSON to preserve local asset paths as fallback
    const existingProjPath = path.join(projectsDir, `${page.id}.json`);
    const existingProj = fs.existsSync(existingProjPath) ? JSON.parse(fs.readFileSync(existingProjPath, 'utf8')) : null;

    // Folder name = {id}--{slug} so it's human-readable on disk
    function slugify(str) {
      return str.normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }
    const projFolder = `${page.id}--${slugify(title)}`;

    // Gallery: prefer Notion "Gallery" property (comma-separated filenames),
    // fall back to whatever is already stored in the JSON.
    const galleryRaw = extractText(p['Gallery']).trim();
    const gallery = galleryRaw
      ? galleryRaw.split(',').map(f => `assets/projects/${projFolder}/${f.trim()}`).filter(Boolean)
      : (existingProj?.gallery || null);

    // Cover: first gallery image if available, otherwise preserve any existing local
    // assets/ path (covers the folder-rename case), otherwise fall back to stock image.
    const coverImage = (gallery && gallery.length)
      ? gallery[0]
      : (existingProj?.coverImage?.startsWith('assets/'))
        ? existingProj.coverImage
        : (SECTOR_IMAGES[sector] || SECTOR_IMAGES.SaaS);

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

    const meta = { notionId: page.id, title, sector, status, year, priority, tags, lede, description, coverImage, metrics, logoDomain, organisations };
    metaList.push(meta);

    const projData = {
      id: page.id, title, sector, status, year, tags, lede, description, coverImage,
      role, timeline, partners, metrics, logoDomain, organisations, sections: displaySections,
    };
    if (gallery) projData.gallery = gallery;

    fs.writeFileSync(
      path.join(projectsDir, `${page.id}.json`),
      JSON.stringify(projData, null, 2)
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
