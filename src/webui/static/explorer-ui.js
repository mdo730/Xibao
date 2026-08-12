// ---- 搜索（地址栏右侧） ----
const searchInput = document.getElementById('search-input');
let searchTimer = null;
function initSearch() {
  searchInput.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 300);
  };
}
async function doSearch() {
  // 任务视图（待审核/标签异常）下不搜索覆盖网格
  if (typeof taskViewMode !== 'undefined' && taskViewMode) {
    if (typeof refreshReviewView === 'function') refreshReviewView();
    return;
  }
  const q = searchInput.value.trim();
  if (!q) { clearTagFilter(); return; }
  // 检索中视觉反馈
  itemGrid.innerHTML = '<div class="search-loading">🔍 检索中…</div>';
  const t0 = Date.now();
  // 限定当前目录：仅搜当前目录（含子目录）内的文件，不做全局搜索
  const scopeDir = (typeof currentPath === 'string' && currentPath) ? currentPath : '';
  const url = '/api/search?q=' + encodeURIComponent(q) +
    (scopeDir ? '&dir=' + encodeURIComponent(scopeDir) : '');
  const r = await fetch(url);
  const d = await r.json();
  // 保证加载提示至少显示 250ms，避免一闪而过
  const elapsed = Date.now() - t0;
  if (elapsed < 250) await new Promise(res => setTimeout(res, 250 - elapsed));
  if (!d.ok) {
    if (d.building) {
      itemGrid.innerHTML = `<div class="search-loading">⏳ ${d.error || '正在建立搜索索引，请稍后再试'}</div>`;
    } else {
      itemGrid.innerHTML = `<div class="search-loading">❌ ${d.error || '搜索失败'}</div>`;
    }
    return;
  }
  data = d;
  render();
  // 搜索状态提示
  const tip = document.createElement('div');
  tip.className = 'muted';
  tip.style.textAlign = 'center';
  tip.style.padding = '6px';
  tip.textContent = (d.folders.length + d.files.length) + ' 个结果 · ' +
    (d.engine === 'everything' ? '⚡ Everything 引擎（毫秒级）' : '📁 本地索引引擎');
  itemGrid.appendChild(tip);
}

async function loadSearchStatus() {
  try {
    const r = await fetch('/api/search/status');
    const d = await r.json();
    if (d.ok && d.engine === 'everything') {
      searchInput.placeholder = '搜索全部文件… ⚡';
      searchInput.title = '当前使用 Everything 引擎（毫秒级）';
    }
  } catch (e) { /* 忽略 */ }
}

loadTags();
loadFileTree();
initSearch();
loadSearchStatus();
// 首次渲染等图标表就绪后执行，避免启动时两次全量 fetch+渲染
ensureIconMap()
  .then(() => refresh())
  .catch(() => refresh());
loadGridSize();
if (typeof initGridSeg === 'function') initGridSeg();
