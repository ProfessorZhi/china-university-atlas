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
    $('modeBadge').textContent = 'Standalone Offline · 0 HTTP';
    $('modeBadge').title = '全部运行数据均已内嵌在此 HTML；正常浏览不会发起网络请求';
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
