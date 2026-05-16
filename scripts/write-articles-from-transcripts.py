#!/usr/bin/env python3
"""
For each article with contentSource='youtube-transcript', use Claude to
write a proper article from the raw transcript. Updates the article JSON
with well-structured HTML content.
"""
import json, os, re, html as html_mod, warnings
warnings.filterwarnings('ignore')

import anthropic

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are an expert editor who transforms spoken transcripts into polished,
well-structured written articles. You preserve the speaker's voice, key insights and examples,
but edit for readability as written prose — removing filler words, false starts and repetition.

Output clean HTML only (no markdown, no code fences). Structure:
- Use <h2> for major sections (2–5 sections depending on length)
- Use <p> for paragraphs (aim for 80–140 words each)
- Use <ul><li> for lists where appropriate
- Use <blockquote> for strong pull quotes from the speaker
- Do NOT include <html>, <body>, <head> tags — just the content fragments"""

def transcript_html_to_text(html_content):
    """Strip HTML tags to get plain transcript text."""
    return re.sub(r'<[^>]+>', ' ', html_content).replace('  ', ' ').strip()

def write_article(title, transcript_text, category):
    prompt = f"""Title: {title}
Category: {category}

Transcript:
{transcript_text[:15000]}

Write a well-structured article based on this transcript. Preserve the speaker's insights
and examples but write it as polished prose, not a transcript. 2–5 sections with <h2> headings."""

    message = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}]
    )
    return message.content[0].text.strip()

articles_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'articles')

for fname in sorted(os.listdir(articles_dir)):
    fpath = os.path.join(articles_dir, fname)
    try:
        art = json.load(open(fpath))
    except Exception:
        continue

    if art.get('contentSource') != 'youtube-transcript':
        continue

    print(f'\nWriting article: "{art["title"]}"')

    transcript_text = transcript_html_to_text(art.get('content', ''))
    if not transcript_text:
        print('  No transcript content, skipping')
        continue

    print(f'  Transcript: {len(transcript_text)} chars → calling Claude...')
    article_html = write_article(art['title'], transcript_text, art.get('category', ''))

    art['content'] = article_html
    art['contentSource'] = 'claude-written'
    json.dump(art, open(fpath, 'w'), indent=2, ensure_ascii=False)
    print(f'  ✓ {len(article_html)} chars written')

print('\nDone.')
