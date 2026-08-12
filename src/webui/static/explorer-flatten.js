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
  flattenState = {...flattenState, path, type: 'all', depth: null, offset: 0, sortKey: 'name', sortDir: 'asc', limit: pageLimit()};
  // 注册分页 scope
  pgRegister('flatten', {
    get: () => ({total: flattenState.total, offset: flattenState.offset, limit: flattenState.limit}),
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
  const banner = document.getElementById('flatten-banner');
  if (banner) banner.remove();
  pgRemove('flatten');
  if (typeof refresh === 'function') refresh();
}

function renderFlattenBanner() {
  let banner = document.getElementById('flatten-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'flatten-banner';
    banner.className = 'flatten-banner';
    const body = document.getElementById('explorer-body');
    body.insertBefore(banner, body.firstChild);
  }
  const name = flattenState.path.split('/').filter(Boolean).pop() || flattenState.path;
  const typeBtns = [['all', '全部'], ['image', '图片'], ['video', '视频'], ['document', '文档']]
    .map(([v, l]) => `<button class="mini ${flattenState.type === v ? 'active' : ''}" onclick="flattenType('${v}')">${l}</button>`).join('');
  banner.innerHTML = `<span class="flatten-title">🔍 平铺：${name}</span>
    <span class="flatten-type">${typeBtns}</span>
    <span class="muted" id="flatten-count"></span>
    <span class="flatten-actions">
      <button class="mini" onclick="exitFlatten()">✕ 退出</button>
    </span>`;
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
  const cnt = document.getElementById('flatten-count');
  if (cnt) cnt.textContent = `共 ${d.total} 个文件`;
  renderFlattenPager();
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
    if (it.type === 'image') {
      display = `<img class="cell-thumb" src="${relUrl(it.path)}" loading="lazy">`;
    } else if (it.type === 'video') {
      display = `<img class="cell-thumb video-thumb" src="/api/thumb?path=${encodeURIComponent(it.path)}&size=256" loading="lazy">`;
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

// 平铺分页：顶部(置顶)+底部 两组，用通用组件
function renderFlattenPager() {
  const grid = document.getElementById('item-grid');
  const body = document.getElementById('explorer-body');
  let top = document.getElementById('pg-top-flatten');
  if (!top) {
    top = document.createElement('div');
    top.id = 'pg-top-flatten';
    top.className = 'flatten-pager pg-sticky';
    // 插入到 explorer-body 顶部（sticky）
    body.insertBefore(top, body.firstChild);
  }
  let bottom = document.getElementById('pg-bottom-flatten');
  if (!bottom) {
    bottom = document.createElement('div');
    bottom.id = 'pg-bottom-flatten';
    bottom.className = 'flatten-pager';
    grid.parentNode.appendChild(bottom);
  }
  renderPager('flatten');
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

// explorer-core.refresh() 拦截：平铺模式下不覆盖
document.addEventListener('DOMContentLoaded', function () {
  const orig = window.refresh;
});
