#!/usr/bin/env python3
"""
For each article JSON that has a youtubeVideoId, fetch the transcript
and replace the content field. Sets contentSource = 'youtube-transcript'.
Runs after fetch-notion-articles.js in the sync workflow.
"""
import json, os, re, html as html_mod, warnings
warnings.filterwarnings('ignore')

from youtube_transcript_api import YouTubeTranscriptApi

def transcript_to_html(snippets):
    texts = [re.sub(r'\[.*?\]', '', s.text).strip() for s in snippets]
    texts = [t for t in texts if t]

    paragraphs, current, word_count = [], [], 0
    for text in texts:
        words = text.split()
        current.extend(words)
        word_count += len(words)
        if word_count >= 80 and re.search(r'[.!?]$', text):
            paragraphs.append(' '.join(current))
            current, word_count = [], 0
    if current:
        paragraphs.append(' '.join(current))

    blocks = []
    for i in range(0, len(paragraphs), 3):
        chunk = paragraphs[i:i+3]
        blocks.append('\n'.join(f'<p>{html_mod.escape(p)}</p>' for p in chunk))
    return '\n'.join(blocks)

articles_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'articles')
api = YouTubeTranscriptApi()

for fname in os.listdir(articles_dir):
    fpath = os.path.join(articles_dir, fname)
    try:
        art = json.load(open(fpath))
    except Exception:
        continue

    vid_id = art.get('youtubeVideoId')
    if not vid_id:
        continue

    print(f'Fetching transcript for "{art["title"]}" ({vid_id})...')
    try:
        transcript = api.fetch(vid_id, languages=['en', 'en-US'])
        content = transcript_to_html(transcript)
        if not content:
            print('  No content extracted, skipping')
            continue
        art['content'] = content
        art['contentSource'] = 'youtube-transcript'
        json.dump(art, open(fpath, 'w'), indent=2)
        print(f'  ✓ {len(content)} chars written')
    except Exception as e:
        print(f'  ✗ {e}')
