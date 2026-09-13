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
