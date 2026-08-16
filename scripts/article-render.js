/**
 * Shared article body renderer — used by both the browser (article.html) and
 * the static-page generator (generate-pages.js) so the pre-rendered HTML is
 * byte-for-byte the same layout the client would build. That means no visible
 * reflow/shift between first paint and hydration.
 *
 * DOM-free (pure string ops) so it runs identically in Node and the browser.
 */
(function (root) {
  var COVER_IMAGES = {
    'Strategy':   'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=1800&q=80',
    'Leadership': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1800&q=80',
    'Product':    'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1800&q=80',
    'Innovation': 'https://images.unsplash.com/photo-1518152006812-edab29b069ac?w=1800&q=80',
    'Health':     'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=1800&q=80',
    'Education':  'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1800&q=80',
    'Technology': 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1800&q=80',
  };
  var DEFAULT_COVER = 'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?w=1800&q=80';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function articleUrl(a) { return '/articles/' + slugify(a.title) + '/'; }
  function stripTags(s) { return String(s || '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); }

  // Split content into sections at <h2> boundaries (content before the first h2
  // is dropped, matching the original DOM-based behaviour).
  function sectionize(html) {
    var re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
    var sections = [], last = null, cursor = 0, m;
    while ((m = re.exec(html))) {
      if (last) last.html = html.slice(cursor, m.index);
      last = { heading: stripTags(m[1]), html: '' };
      sections.push(last);
      cursor = re.lastIndex;
    }
    if (last) last.html = html.slice(cursor);
    return sections;
  }

  function firstParagraphText(html) {
    var m = String(html || '').match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    return m ? stripTags(m[1]) : '';
  }

  // Returns the innerHTML for #main-content, identical to the client build.
  function buildArticleBody(article, all) {
    var content = article.content || '';
    var sections = sectionize(content);

    var tocItems = sections.map(function(s, i) {
      var num = (i + 1 < 10 ? '0' : '') + (i + 1);
      var anchor = 'section-' + i;
      return '<li><span class="cs-toc__num">' + num + '</span>'
        + '<a href="#' + anchor + '">' + esc(s.heading) + '</a></li>';
    }).join('');

    var sectionsHtml = sections.length
      ? sections.map(function(s, i) {
          var num = (i + 1 < 10 ? '0' : '') + (i + 1);
          var anchor = 'section-' + i;
          var ledeClass = i === 0 ? ' cs-section--lede' : '';
          return '<section class="cs-section' + ledeClass + '" id="' + anchor + '">'
            + '<div class="cs-section__head">'
            + '<span class="cs-section__num">' + num + '</span>'
            + '<h2>' + esc(s.heading) + '</h2>'
            + '</div>'
            + s.html
            + '</section>';
        }).join('')
      : '<article style="max-width:760px">' + content + '</article>';

    var lede = firstParagraphText(content);
    var coverSrc = article.coverImage || COVER_IMAGES[article.category] || DEFAULT_COVER;

    var idx = all.findIndex(function(a) { return a.notionId === article.notionId; });
    var prev = idx > 0 ? all[idx - 1] : null;
    var next = idx >= 0 ? all[(idx + 1) % all.length] : null;
    if (next && next.notionId === article.notionId) next = null;

    var counter = idx >= 0 ? (String(idx + 1).padStart(2,'0') + ' / ' + String(all.length).padStart(2,'0')) : '';
    var prevLink = prev
      ? '<a href="' + articleUrl(prev) + '" class="proj-pager__link proj-pager__link--prev">'
        + '<span class="proj-pager__arrow"><svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M15 6H1m0 0l5-5m-5 5l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg></span>'
        + '<span class="proj-pager__meta"><span class="proj-pager__label">Previous</span><span class="proj-pager__title">' + esc(prev.title) + '</span></span>'
        + '</a>'
      : '<span></span>';
    var nextPagerLink = next
      ? '<a href="' + articleUrl(next) + '" class="proj-pager__link proj-pager__link--next">'
        + '<span class="proj-pager__meta"><span class="proj-pager__label">Next</span><span class="proj-pager__title">' + esc(next.title) + '</span></span>'
        + '<span class="proj-pager__arrow"><svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M1 6h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg></span>'
        + '</a>'
      : '<span></span>';
    var pagerHtml = '<nav class="proj-pager">' + prevLink + '<span class="proj-pager__index">' + counter + '</span>' + nextPagerLink + '</nav>';

    var nextHtml = '';
    if (next) {
      var nextCover = next.coverImage || COVER_IMAGES[next.category] || DEFAULT_COVER;
      nextHtml = '<section class="next-proj">'
        + '<p class="next-proj__eyebrow">Next Article</p>'
        + '<a href="' + articleUrl(next) + '" class="next-proj__card">'
        + '<img class="bw-img" src="' + nextCover + '" alt="' + esc(next.title) + '">'
        + '<div class="next-proj__text">'
        + '<span class="tag-line">' + esc(next.category) + '</span>'
        + '<h3>' + esc(next.title)
        + '<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><path d="M1 7h19m0 0l-6-6m6 6l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>'
        + '</h3>'
        + '<p>' + (next.readingTime ? next.readingTime + ' min read' : next.year) + '</p>'
        + '</div>'
        + '</a></section>';
    }

    return pagerHtml
      + '<section class="cs-hero">'
      + '<p class="cs-hero__crumb">Journal &nbsp;/&nbsp; ' + esc(article.category) + '</p>'
      + '<h1>' + esc(article.title) + '</h1>'
      + (lede ? '<p class="cs-hero__lede">' + esc(lede) + '</p>' : '')
      + '<div class="cs-hero__byline">'
      + '<div class="cs-hero__byline-block"><h5>Published</h5><p>' + esc(String(article.year)) + '</p></div>'
      + (article.readingTime ? '<div class="cs-hero__byline-block"><h5>Reading time</h5><p>' + article.readingTime + ' minutes</p></div>' : '')
      + '</div>'
      + '<div class="cs-cover">'
      + (article.youtubeVideoId
          ? '<div class="cs-cover__video"><iframe src="https://www.youtube.com/embed/' + esc(article.youtubeVideoId) + '?rel=0" title="' + esc(article.title) + '" allowfullscreen loading="lazy"></iframe></div>'
          : article.linkedInEmbedUrl
            ? '<div class="cs-cover__video cs-cover__video--linkedin"><iframe src="' + esc(article.linkedInEmbedUrl) + '" title="' + esc(article.title) + '" allowfullscreen loading="lazy"></iframe></div>'
            : '<img class="bw-img" src="' + coverSrc + '" alt="' + esc(article.title) + '"' + (article.coverImagePosition ? ' style="object-position:' + esc(article.coverImagePosition) + '"' : '') + '>')
      + '</div>'
      + '</section>'

      + '<div class="cs-body">'
      + '<aside class="cs-aside">'
      + '<h4>Topics</h4>'
      + '<div class="chips">'
      + (article.tags && article.tags.length ? article.tags : [article.category]).map(function(t) {
          return '<a href="articles.html?category=' + encodeURIComponent(t) + '" class="tag">' + esc(t) + '</a>';
        }).join('')
      + '</div>'
      + (tocItems ? '<div class="cs-toc-wrap"><h4>In this article</h4><ol class="cs-toc">' + tocItems + '</ol></div>' : '')
      + '</aside>'

      + '<div class="cs-content">' + sectionsHtml + '</div>'
      + '</div>'

      + nextHtml;
  }

  var api = { buildArticleBody: buildArticleBody, articleUrl: articleUrl, slugify: slugify, esc: esc, COVER_IMAGES: COVER_IMAGES, DEFAULT_COVER: DEFAULT_COVER };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ArticleRender = api;
})(typeof window !== 'undefined' ? window : null);
