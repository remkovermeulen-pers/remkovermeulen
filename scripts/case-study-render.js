/**
 * Shared case-study body renderer — used by the static-page generator so the
 * pre-rendered /work/<slug>/ HTML is the exact same layout the client builds,
 * eliminating the flash/reflow on load. Mirrors the render helpers in
 * case-study.html; keep the two in sync. DOM-free so it runs under Node.
 *
 * The cover gallery's interactivity lives in case-study.html and is bound via
 * document-level event delegation + a DOMContentLoaded observer, so it drives
 * this baked markup without any re-initialisation.
 */
(function (root) {
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }
  function workUrl(p) { return '/work/' + slugify(p.title) + '/'; }
  function stripTags(s) { return String(s || '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim(); }

  var LOGO_FILES = {
    'Toggl':                        'toggl.com.svg',
    'Johnson & Johnson':            'jandj.com.svg',
    'Koa Health':                   'koa.health.com.png',
    'Financial Times':              'ft.com.svg',
    'Telefónica / O2':              'telefonica.com.svg',
    'Renault':                      'renault.com.svg',
    'British Council':              'british-council.svg',
  };
  function getLogoFile(proj) { return LOGO_FILES[proj.title] || ''; }
  function logoUrl(filename) { return 'assets/logos/' + filename; }
  function buildLogos(proj, noMetrics) {
    var orgs = proj.organisations || [];
    var files = orgs.map(function(o) { return typeof o === 'string' ? o : o.logo; }).filter(Boolean);
    if (!files.length) return '';
    return '<div class="cs-hero__byline-logos' + (noMetrics ? ' cs-hero__byline-logos--first' : '') + '">'
      + '<h5>Organisations</h5>'
      + '<div class="cs-hero__byline-logos__imgs">'
      + files.map(function(f) { return '<img src="assets/logos/' + esc(f) + '" alt="" onerror="this.remove()">'; }).join('')
      + '</div>'
      + '</div>';
  }

  function isVideo(src)   { return /\.(mov|mp4|webm|ogg)$/i.test(src || ''); }
  function isYouTube(src) { return /youtu\.?be/.test(src || ''); }
  function ytThumbUrl(src) {
    var m = (src || '').match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    return m ? 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' : src;
  }
  function ytEmbedUrl(src) {
    var m = src.match(/(?:youtu\.be\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (!m) return src;
    var t = src.match(/[?&]t=(\d+)/);
    return 'https://www.youtube.com/embed/' + m[1] + '?rel=0' + (t ? '&start=' + t[1] : '');
  }
  function buildMediaEl(src, alt) {
    if (isYouTube(src)) return '<iframe class="cs-cover__yt" src="' + esc(ytEmbedUrl(src)) + '" allowfullscreen loading="lazy"></iframe>';
    if (isVideo(src)) return '<video class="cs-cover__img" autoplay muted loop playsinline src="' + esc(src) + '"></video>';
    return '<img class="cs-cover__img" src="' + esc(src) + '" alt="' + esc(alt || '') + '">';
  }

  function buildSections(sections) {
    return (sections || []).map(function(sec, i) {
      var num = String(i + 1).padStart(2, '0');
      var anchor = sec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      return '<section class="cs-section" id="' + anchor + '">' +
        '<div class="cs-section__head">' +
          '<span class="cs-section__num">' + num + '</span>' +
          '<h2>' + esc(sec.title) + '</h2>' +
        '</div>' +
        sec.body +
      '</section>';
    }).join('');
  }

  function buildSidebar(proj) {
    var chips = (proj.tags || []).map(function(t) {
      return '<a href="work.html?tag=' + encodeURIComponent(t) + '" class="tag">' + esc(t) + '</a>';
    }).join('');
    var meta = '';
    if (proj.role) meta += '<div class="cs-aside__meta-block"><h5>Role</h5><p>' + esc(proj.role) + '</p></div>';
    if (proj.timeline) meta += '<div class="cs-aside__meta-block"><h5>Timeline</h5><p>' + esc(proj.timeline) + '</p></div>';
    if (proj.partners && proj.partners.length) meta += '<div class="cs-aside__meta-block"><h5>Partners</h5><p>' + proj.partners.join('<br>') + '</p></div>';
    var toc = '';
    if (proj.sections && proj.sections.length) {
      var tocItems = proj.sections.map(function(sec, i) {
        var num = String(i + 1).padStart(2, '0');
        var anchor = sec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        return '<li><span class="cs-toc__num">' + num + '</span><a href="#' + anchor + '">' + esc(sec.title) + '</a></li>';
      }).join('');
      toc = '<div class="cs-toc-wrap"><h4>Contents</h4><ol class="cs-toc">' + tocItems + '</ol></div>';
    }
    return toc +
           (chips ? '<h4 class="cs-aside__tags-head">Tags</h4><div class="chips">' + chips + '</div>' : '') +
           (meta ? '<div class="cs-aside__meta">' + meta + '</div>' : '');
  }

  function buildRelatedProjects(proj, all) {
    var ids = proj.relatedProjects || [];
    if (!ids.length) return '';
    var projs = ids.map(function(id) { return all.find(function(p) { return p.notionId === id || p.id === id; }); }).filter(Boolean);
    if (!projs.length) return '';
    var items = projs.map(function(p) {
      var cover = p.coverImage || '';
      var isVid = /\.(mp4|mov|webm)$/i.test(cover);
      var thumbSrc = isYouTube(cover) ? ytThumbUrl(cover) : cover;
      var thumbHtml = cover
        ? (isVid
            ? '<video src="' + esc(cover) + '" muted playsinline loop autoplay></video>'
            : '<img src="' + esc(thumbSrc) + '" alt="" loading="lazy">')
        : '';
      return '<a href="' + workUrl(p) + '" class="cs-related-item">'
        + '<div class="cs-related-item__thumb">' + thumbHtml + '</div>'
        + '<div>'
        + '<div class="cs-related-item__title">' + esc(p.title) + '</div>'
        + (p.year ? '<div class="cs-related-item__year">' + esc(String(p.year)) + '</div>' : '')
        + '</div>'
        + '</a>';
    }).join('');
    return '<div class="cs-related"><h5>Products</h5><div class="cs-related-list">' + items + '</div></div>';
  }

  function buildNext(next) {
    if (!next) return '';
    return '<section class="next-proj">' +
      '<p class="next-proj__eyebrow">Next Project</p>' +
      '<a href="' + workUrl(next) + '" class="next-proj__card">' +
        '<img class="bw-img" src="' + esc(next.coverImage || 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=1200&q=80') + '" alt="' + esc(next.title) + '">' +
        '<div class="next-proj__text">' +
          '<h3>' + esc(next.title) +
            '<svg width="22" height="14" viewBox="0 0 22 14" fill="none"><path d="M1 7h19m0 0l-6-6m6 6l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg>' +
          '</h3>' +
          '<p>' + esc(next.lede) + '</p>' +
        '</div>' +
      '</a>' +
    '</section>';
  }

  function buildPager(proj, prev, next, all) {
    var idx = all.findIndex(function(p) { return p.notionId === proj.id; });
    var total = all.length;
    var counter = idx !== -1 ? (String(idx + 1).padStart(2, '0') + ' / ' + String(total).padStart(2, '0')) : '';
    var prevLink = prev
      ? '<a href="' + workUrl(prev) + '" class="proj-pager__link proj-pager__link--prev">' +
          '<span class="proj-pager__arrow"><svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M15 6H1m0 0l5-5m-5 5l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg></span>' +
          '<span class="proj-pager__meta"><span class="proj-pager__label">Previous</span><span class="proj-pager__title">' + esc(prev.title) + '</span></span>' +
        '</a>'
      : '<span></span>';
    var nextLink = next
      ? '<a href="' + workUrl(next) + '" class="proj-pager__link proj-pager__link--next">' +
          '<span class="proj-pager__meta"><span class="proj-pager__label">Next</span><span class="proj-pager__title">' + esc(next.title) + '</span></span>' +
          '<span class="proj-pager__arrow"><svg width="16" height="12" viewBox="0 0 16 12" fill="none"><path d="M1 6h14m0 0l-5-5m5 5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"/></svg></span>' +
        '</a>'
      : '<span></span>';
    return '<nav class="proj-pager">' + prevLink + '<span class="proj-pager__index">' + counter + '</span>' + nextLink + '</nav>';
  }

  function buildByline(metrics, proj) {
    var blocks = (metrics || []).slice(0, 3).map(function(m) {
      return '<div class="cs-hero__byline-block">' +
        '<h5>' + esc(m.label) + '</h5>' +
        '<span class="metric">' + esc(m.value) + '</span>' +
        (m.description ? '<p>' + esc(m.description) + '</p>' : '') +
      '</div>';
    }).join('');
    var logos = buildLogos(proj, !blocks);
    if (!blocks && !logos) return '';
    return '<div class="cs-hero__byline">' + blocks + logos + '</div>';
  }

  function getNext(currentId, all) {
    var idx = all.findIndex(function(p) { return p.notionId === currentId; });
    if (idx === -1) return all[0] || null;
    var next = all[(idx + 1) % all.length];
    return next.notionId === currentId ? null : next;
  }
  function getPrev(currentId, all) {
    var idx = all.findIndex(function(p) { return p.notionId === currentId; });
    if (idx === -1) return null;
    if (idx === 0) return null;
    return all[idx - 1];
  }

  function buildCaseStudyBody(proj, all) {
    var nextProj    = getNext(proj.id, all);
    var prevProj    = getPrev(proj.id, all);
    var sectionsHtml = buildSections(proj.sections);
    var sidebarHtml  = buildSidebar(proj);
    var nextHtml     = buildNext(nextProj);
    var pagerHtml    = buildPager(proj, prevProj, nextProj, all);
    var bylineHtml   = buildByline(proj.metrics, proj);

    var ledeText = proj.description || '';
    if (!ledeText && proj.sections && proj.sections.length) ledeText = stripTags(proj.sections[0].body);
    if (!ledeText) ledeText = proj.lede;

    var slideItems = (proj.gallery && proj.gallery.length) ? proj.gallery : (proj.coverImage ? [proj.coverImage] : []);
    var hasMultiple = slideItems.length > 1;
    var prevBtn = hasMultiple ? '<button class="cs-cover__prev" aria-label="Previous"><svg width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M17 7H1m0 0l6-6M1 7l6 6" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg></button>' : '';
    var nextBtn = hasMultiple ? '<button class="cs-cover__next" aria-label="Next"><svg width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M1 7h16m0 0l-6-6m6 6l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="square"/></svg></button>' : '';
    var dotsHtml = hasMultiple ? '<div class="cs-cover__dots">' + slideItems.map(function(_,i){ return '<span class="cs-cover__dot' + (i===0?' is-active':'') + '" data-idx="'+i+'"></span>'; }).join('') + '</div>' : '';
    var slideData = hasMultiple ? ' data-slides="' + esc(JSON.stringify(slideItems)) + '"' : '';

    return pagerHtml +
      '<section class="cs-hero">' +
        '<p class="cs-hero__crumb">Case Study</p>' +
        '<h1>' + esc(proj.title) + '</h1>' +
        '<p class="cs-hero__lede">' + esc(ledeText) + '</p>' +
        bylineHtml +
        '<div class="cs-cover"' + slideData + '>' +
          '<div class="cs-cover__track">' +
          slideItems.map(function(src) { return '<div class="cs-cover__slide">' + buildMediaEl(src, proj.title) + '</div>'; }).join('') +
          '</div>' +
          prevBtn +
          (getLogoFile(proj) ? '<img class="cs-cover__logo" src="' + logoUrl(getLogoFile(proj)) + '" alt="" onerror="this.remove()">' : '') +
          (proj.coverCaption ? '<div class="cs-cover__caption">' + esc(proj.coverCaption) + '</div>' : '') +
          dotsHtml +
          nextBtn +
        '</div>' +
      '</section>' +
      '<div class="cs-body">' +
        '<aside class="cs-aside">' + sidebarHtml + buildRelatedProjects(proj, all) + '</aside>' +
        '<article class="cs-content">' + sectionsHtml + '</article>' +
      '</div>' +
      nextHtml;
  }

  var api = { buildCaseStudyBody: buildCaseStudyBody, slugify: slugify, workUrl: workUrl, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CaseStudyRender = api;
})(typeof window !== 'undefined' ? window : null);
