// V5.7 standalone-offline UX layer. Loaded after all feature layers and before boot().
// It does not own data or winner logic; it only wraps startup/status/keyboard behavior.
(() => {
  const originalReadEmbeddedJson = readEmbeddedJson;
  readEmbeddedJson = async function(id) {
    const el = $(id), encodedBytes = el?.textContent?.length || 0;
    const value = await originalReadEmbeddedJson(id);
    // The decoded object is now held by D/CACHE. Drop the large base64 text node so the DOM
    // does not keep a second copy of the compressed payload alive for the whole session.
    if (el) { el.textContent = ''; el.dataset.released = 'true'; el.dataset.encodedBytes = String(encodedBytes); }
    return value;
  };

  const originalUpdateCacheStatus = updateCacheStatus;
  updateCacheStatus = function() {
    originalUpdateCacheStatus();
    const st = D?.stats || {};
    $('cacheStatus').textContent = `单文件离线 · ${Object.keys(CACHE).length} 份边界 · ${st.ordinarySchools || 0} 所普通高校 · ${(D?.campuses || []).length} 条办学地点`;
    // "0 HTTP" is the build's own acceptance number, not something a reader of the map can act on.
    // What a reader needs to know is that it works without a connection; the exact request count
    // stays in 数据说明 and the footer, where someone auditing the offline claim will look for it.
    $('modeBadge').textContent = '离线可用';
    $('modeBadge').title = '全部运行数据均已内嵌在此 HTML，正常浏览不会发起网络请求（构建验收为 0 HTTP）';
    // The legend used to print four hard-coded swatches that were not in the map palette.
    // It now renders the map's own fill family, so the legend cannot contradict the map.
    const legend = $('legendSwatches');
    if (legend && !legend.querySelector('i')) {
      legend.innerHTML = palette.map(c => `<i style="background:${c}"></i>`).join('')
        + ' 同色系仅用于区分相邻行政区，不表示排名或层级';
      /* The two keys are siblings of the swatch line, not children of it. #legendSwatches is itself an
         inline-flex row, so a full-width child inside it made the flex algorithm size the container
         against a percentage of its own unknown width - Chrome resolved that by wrapping the swatch
         sentence onto three short lines. As siblings they take one row each and the legend sizes to
         its widest row. */
      const zoom = $('zoomInfo');
      if (zoom && !document.querySelector('.legendkey')) {
        /* afterend, not beforebegin: the wrapping row has to come after the zoom readout, or its
           full-width basis pushes the readout onto a line of its own. */
        zoom.insertAdjacentHTML('afterend',
          /* Both keys go inside one wrapping row: each key taking a row of its own made the legend a
             four-line card that pushed the zoom readout onto a line of its own and covered a corner of
             the map. The row is the unit that wraps, so the two keys share a line whenever the width
             allows and stack when it does not. */
          '<span class="legendrow">'
          /* The map prints two tiers of text and only one of them is a school. The key names both in
             their own colour, so the red is not left to be guessed at, and the colour does the
             explaining, which costs no width. */
          + '<span class="legendkey">名称：<b class="k-region">地区</b> · <b class="k-uni">最佳高校</b></span>'
          /* Shown only while the campus-pin layer is on the map; city-layer toggles the hidden flag.
             The two dot colours are the tones the pins already use, so the key cannot drift. */
          + '<span class="legendpins" hidden><i class="kp-verified"></i>已核对地点 <i class="kp-caution"></i>待核验地点</span>'
          + '</span>');
      }
    }
  };

  // Keep labels geographically honest: never move a name out of the administrative polygon and
  // never draw a leader line across the map. The label remains a screen-space SVG element so its
  // halo stays crisp, but its font size follows the same zoom ratio as the geometry.
  const regionContainsScreenPoint = (b, sx, sy) => {
    const z = S.z || 1;
    const p = [(sx - S.x) / z, (sy - S.y) / z];
    let inside = false;
    for (const ring of b.rings) if (inRing(p, ring)) inside = !inside;
    return inside;
  };
  const boxInsideRegion = (b, box) => {
    const inset = Math.max(0.8, Math.min(2, 1.2 * (S.z || 1)));
    const xs = [box.l + inset, (box.l + box.r) / 2, box.r - inset];
    const ys = [box.t + inset, (box.t + box.b) / 2, box.b - inset];
    return xs.every(x => ys.every(y => regionContainsScreenPoint(b, x, y)));
  };
  const uiRectsInMap = () => {
    const mapRect = $('map').getBoundingClientRect();
    return [...document.querySelectorAll('.maphead,.mapcontrols,.legend')]
      .filter(el => el.getClientRects().length)
      .map(el => { const r = el.getBoundingClientRect(); return {l:r.left-mapRect.left-3,r:r.right-mapRect.left+3,t:r.top-mapRect.top-3,b:r.bottom-mapRect.top+3}; });
  };
  const boxesOverlap = (a, b) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
  const labelBoxAllowed = (box, nation, uiRects) => {
    if (box.l < 4 || box.r > S.w - 4 || box.t < 4 || box.b > S.h - 4) return false;
    if (uiRects.some(r => boxesOverlap(box, r))) return false;
    if (nation && S.insetBox && boxesOverlap(box, S.insetBox)) return false;
    return true;
  };
  const lineSetFor = (b, nation, includeUni, font) => {
    const names = wrap(nation ? short(b.f.name) : b.f.name, 11);
    const us = includeUni && b.best.u ? wrap(b.best.u, nation ? 8 : 10) : [];
    return names.map(t => ({t,fs:font*.91,c:'#274b5a',w:650}))
      .concat(us.map(t => ({t,fs:font,c:'#c62d28',w:800})));
  };
  const labelCandidate = (b, nation, includeUni, font, uiRects) => {
    const x = b.cp[0] * S.z + S.x, y = b.cp[1] * S.z + S.y;
    const lines = lineSetFor(b, nation, includeUni, font);
    const width = Math.max(...lines.map(l => textWidth(l.t,l.fs,l.w))) + 9 * S.z;
    const height = lines.length * font * 1.27 + 5 * S.z;
    const box = {l:x-width/2,r:x+width/2,t:y-height/2,b:y+height/2};
    if (!labelBoxAllowed(box, nation, uiRects) || !boxInsideRegion(b, box)) return null;
    return {x,y,width,height,box,lines,font};
  };

  drawLabels = function() {
    const g = $('labelLayer'); g.innerHTML = '';
    const nation = current().kind === 'country';
    const zoom = S.z || 1;
    const preferred = (nation ? 11.3 : 12.7) * Number($('fontSize').value) / 100 * zoom;
    // Relative shrink factors are zoom-invariant: zooming the map by 2x also zooms every label by 2x.
    const scales = [1, .92, .84, .78];
    const minRegionFont = 9 * zoom * Number($('fontSize').value) / 100;
    const uiRects = uiRectsInMap();
    const items = S.base.filter(b => b.f.name).map(b => ({...b,best:best(b.f)}))
      .sort((a,b) => Number(!!b.best.u)-Number(!!a.best.u) || b.area-a.area);
    let shown = 0, nameOnly = 0, uniLabels = 0;
    S.labels = [];
    for (const b of items) {
      const x = b.cp[0] * zoom + S.x, y = b.cp[1] * zoom + S.y;
      if (x < -100 || y < -100 || x > S.w + 100 || y > S.h + 100) continue;
      let chosen = null, includeUni = !!($('showUni').checked && b.best.u);
      for (const wantUni of includeUni ? [true,false] : [false]) {
        for (const scale of scales) {
          const font = preferred * scale;
          if (font * .91 < minRegionFont - .01) continue;
          chosen = labelCandidate(b, nation, wantUni, font, uiRects);
          if (chosen) { includeUni = wantUni; break; }
        }
        if (chosen) break;
      }
      if (!chosen) continue;
      S.labels.push(chosen.box); shown++;
      if (includeUni) uniLabels++; else if (b.best.u) nameOnly++;
      const group = E('g', {'data-label-id':b.f.id,'data-place-tier':includeUni?'2':'1'});
      chosen.lines.forEach((l,i) => group.append(E('text',{
        x:chosen.x,
        y:chosen.y-chosen.height/2+chosen.font*1.08+i*chosen.font*1.27,
        'text-anchor':'middle','font-size':l.fs.toFixed(2),'font-weight':l.w,
        'font-family':'"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif',
        fill:l.c,stroke:'#ffffff','stroke-width':Math.min(2,Math.max(1,l.fs*.11)).toFixed(2),
        'stroke-linejoin':'round','paint-order':'stroke fill'
      },l.t)));
      g.append(group);
    }
    if (current().kind === 'district') drawCampusPins(g);
    S.labelCount = shown;
    window.__labelPlacementStats = {labels:shown,hidden:items.length-shown,nameOnly,uniLabels,leaders:0,displaced:0,minFont:shown?Math.min(...[...g.querySelectorAll('text')].map(t=>Number(t.getAttribute('font-size')))):null};
  };

  // The old outer-edge underlay filled the parent polygon dark and relied on child fills to cover it.
  // Any topology gap therefore surfaced as a thick dark "框" inside a province. Local views now draw
  // only the parent outline; the national view keeps the underlay trick because it is what removes
  // internal province strokes from the country silhouette.
  drawEdges = function(nation, scale, tx, ty) {
    const g = $('edgeLayer'); g.innerHTML = ''; let rings;
    if (nation) rings = S.base.filter(b => b.f.name).flatMap(b => b.rings);
    else {
      const par = current().f; if (!par) return;
      rings = par.rings.map(r => r.map(p => { const q = project(p); return [q[0]*scale+tx,q[1]*scale+ty]; }));
    }
    if (!rings.length) return;
    const d = rings.map(r => 'M'+r.map(p => p[0].toFixed(2)+','+p[1].toFixed(2)).join('L')+'Z').join('');
    g.append(E('path',{d,fill:nation?MAP_STYLE.edge:'none',stroke:MAP_STYLE.edge,'stroke-width':4.6,
      'stroke-linejoin':'round','fill-rule':'evenodd','vector-effect':'non-scaling-stroke','pointer-events':'none'}));
  };

  const originalBoot = boot;
  boot = async function() {
    const splash = $('bootSplash'), splashText = $('bootSplashText');
    const started = performance.now();
    if (splashText) splashText.textContent = '正在解压内嵌高校与行政区数据…';
    await originalBoot();
    const ok = !!D && Object.keys(CACHE || {}).length > 0;
    const ms = Math.round(performance.now() - started);
    window.__bootMetrics = {
      ms,
      ok,
      schoolPayloadReleased: $('schoolData')?.dataset.released === 'true',
      geoPayloadReleased: $('geoData')?.dataset.released === 'true'
    };
    // Labels are no longer displaced, so the old "自动避让" toggle has no effect and should not
    // advertise a behavior the map deliberately removed.
    const avoidControl = $('avoid');
    if (avoidControl?.closest('label')) avoidControl.closest('label').hidden = true;
    const ruleParagraph = [...document.querySelectorAll('#dataDialog p')]
      .find(p => p.textContent.includes('地图标签会先根据校名长度自动缩字号'));
    if (ruleParagraph) ruleParagraph.innerHTML = '<b>县区规则：</b>继续按具体校园物理位置展示；只有县区归属线索、没有校园门牌时，单独记为“县区归属依据”，不造坐标。地图标签固定在所属行政区内部并随地图缩放；空间不足时先省略高校名，再隐藏该标签，不再跨区拉引导线。';
    if (ok) {
      document.body.classList.add('app-ready');
      document.body.dataset.bootMs = String(ms);
      if (splash) splash.hidden = true;
    } else if (splash) {
      splash.classList.add('error');
      if (splashText) splashText.textContent = '离线数据打开失败，请使用最新版 Chrome / Edge / Firefox / Safari。';
    }
  };

  document.addEventListener('keydown', e => {
    const target = e.target;
    const typing = target && ['INPUT','TEXTAREA','SELECT'].includes(target.tagName);
    if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      $('search')?.focus();
      $('search')?.select();
    }
  });
})();
