// ---- 平铺文件夹（v0.6.1）----
// 独立模式：点文件夹右键「平铺文件夹」→ 递归显示该目录所有文件（带类型过滤/分页）
let flattenMode = false;
let flattenState = {path: '', type: 'all', depth: null, offset: 0, limit: 100,
                    sortKey: 'name', sortDir: 'asc', total: 0};

function ctxFlattenFolder() {
  hideContextMenus();
  if (!ctxItem || ctxItem.kind !== 'folder') return;
  enterFlatten(ctxItem.path);
}

function enterFlatten(path) {
  flattenMode = true;
  // 平铺接管分页导航：先撤掉普通浏览的分页条，避免两套导航并存
  if (typeof browseUnregister === 'function') browseUnregister();
  flattenState = {...flattenState, path, type: 'all', depth: null, offset: 0, sortKey: 'name', sortDir: 'asc', limit: pageLimit()};
  // 注册分页 scope
  pgRegister('flatten', {
    get: () => ({total: flattenState.total, offset: flattenState.offset, limit: flattenState.limit, type: flattenState.type}),
    prev: () => flattenPage(-1),
    next: () => flattenPage(1),
    jump: (off) => flattenGoto(off),
    size: (lim) => { flattenState.limit = lim; flattenState.offset = 0; loadFlatten(); },
  });
  renderFlattenBanner();
  loadFlatten();
}

function exitFlatten() {
  flattenMode = false;
  pgRemove('flatten');
  if (typeof refresh === 'function') refresh();
}

function renderFlattenBanner() {
  const name = flattenState.path.split('/').filter(Boolean).pop() || flattenState.path;
  pgRenderBanner('flatten', {
    title: '🔍 平铺：' + name,
    types: [['all', '全部'], ['image', '图片'], ['video', '视频'], ['document', '文档']],
    onType: 'flattenType',
    actions: '<button class="mini" onclick="exitFlatten()">✕ 退出</button>',
  });
}

async function loadFlatten() {
  const s = flattenState;
  const params = new URLSearchParams({
    type: s.type, offset: s.offset, limit: s.limit,
    sort: s.sortKey, dir: s.sortDir,
  });
  if (s.depth != null) params.set('depth', s.depth);
  const url = '/api/folders/' + s.path.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/flatten?' + params;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.ok) {
    const grid = document.getElementById('item-grid');
    if (grid) grid.innerHTML = '<p class="muted" style="padding:40px;text-align:center">平铺失败: ' + (d.error || '') + '</p>';
    return;
  }
  flattenState.total = d.total;
  renderFlattenGrid(d.items);
  renderFlattenBanner();
  pgRenderBottom('flatten');
}

function renderFlattenGrid(items) {
  const grid = document.getElementById('item-grid');
  if (!grid) return;
  grid.className = 'grid-view';
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<div class="review-empty"><div>此目录下没有匹配的文件</div><button class="mini" style="margin-top:12px" onclick="exitFlatten()">退出平铺</button></div>';
    return;
  }
  for (const it of items) {
    const card = document.createElement('div');
    card.className = 'cell cell-file flatten-card';
    card.dataset.path = it.path;
    card.dataset.key = it.path;
    let display = '';
    if (it.type === 'image' || it.type === 'video') {
      display = `<img class="cell-thumb" src="${thumbUrl(it.path)}" loading="lazy">`;
    } else {
      display = fileIconHtml(it.name, 'cell-icon-img', 'cell-icon', iconOf(it.type), it.path);
    }
    card.innerHTML = `
      <div class="cell-content">${display}</div>
      <div class="cell-name">${escHtml(it.name)}</div>
      <div class="cell-meta muted" title="${escHtml(it.folder_rel_path)}">${escHtml(it.folder_rel_path || '/')}</div>`;
    card.onclick = e => { if (typeof onItemClick === 'function') onItemClick(e, 0, it.path, false); };
    card.ondblclick = () => openFile(it.path);
    grid.appendChild(card);
  }
}

function flattenGoto(offset) {
  flattenState.offset = Math.max(0, Math.min(offset, Math.max(0, flattenState.total - 1)));
  loadFlatten();
  const body = document.getElementById('explorer-body');
  if (body) body.scrollTop = 0;
}

function flattenPage(delta) {
  const s = flattenState;
  const next = s.offset + delta * s.limit;
  if (next < 0 || next >= s.total) return;
  flattenGoto(next);
}

function flattenType(t) {
  flattenState.type = t;
  flattenState.offset = 0;
  renderFlattenBanner();
  loadFlatten();
}

// 平铺模式下切换排序：同步 flattenState 并重载（由 setSortField/setSortDir 转发）
function flattenSetSort() {
  flattenState.sortKey = sortKey;
  flattenState.sortDir = sortDir;
  flattenState.offset = 0;
  if (typeof renderSortMenuActive === 'function') renderSortMenuActive();
  loadFlatten();
}

// explorer-core.refresh() 拦截：平铺模式下不覆盖
document.addEventListener('DOMContentLoaded', function () {
  const orig = window.refresh;
});
