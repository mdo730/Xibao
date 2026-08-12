// 西煲 - Win11 风格资源管理器
const itemGrid = document.getElementById('item-grid');
const addressText = document.getElementById('address-text');
const fileTreeEl = document.getElementById('file-tree');

let currentPath = '';
let currentTagIds = [];
const selected = new Set();
let ctxItem = null;
let tagCtxItem = null;
let tagModalPaths = [];
let viewMode = 'grid';
let sortKey = 'name';
let sortDir = 'asc';
let data = null;
let allTags = [];
let navHist = [];
let navIdx = -1;
const collapsedTags = new Set();

const TYPE_ICON = {folder:'📁', image:'🖼', video:'🎬', audio:'🎵', pdf:'📕', doc:'📄', archive:'🗜', code:'💻', other:'📄'};
function iconOf(t) { return TYPE_ICON[t] || '📄'; }

// ---- 备注名（alias）显示工具 ----
const ALIAS_MODE_KEY = 'xibao_alias_mode';     // 'file'=以文件名为主 | 'alias'=以备注名为主
const ALIAS_BG_KEY = 'xibao_alias_bg';         // 备注名底色
function aliasMode() { return localStorage.getItem(ALIAS_MODE_KEY) === 'alias' ? 'alias' : 'file'; }
function setAliasMode(m) { localStorage.setItem(ALIAS_MODE_KEY, m); }
function toggleAliasMode() { setAliasMode(aliasMode() === 'alias' ? 'file' : 'alias'); }
function aliasBg() { return localStorage.getItem(ALIAS_BG_KEY) || '#e8f0fe'; }
function setAliasBg(c) { localStorage.setItem(ALIAS_BG_KEY, c); }
// 取显示名：优先显示模式决定；对偶名用于悬停提示
function displayName(it) {
  if (aliasMode() === 'alias' && it.alias) return it.alias;
  return it.name;
}
function hintName(it) {
  // 显示的是别名时提示真名；显示真名且有条目别名时提示别名
  if (aliasMode() === 'alias') return it.alias ? it.name : '';
  return it.alias || '';
}
// 名字 HTML：是否带底色（仅当显示的确实是别名时）
function nameHtml(it) {
  const shown = displayName(it);
  const isAliasShown = aliasMode() === 'alias' && it.alias;
  const hint = hintName(it);
  let title = hint ? `名称: ${hint}` : '';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let inner = esc(shown);
  if (isAliasShown) {
    inner = `<span class="alias-name" style="background:${aliasBg()}" title="${esc(title)}">${inner}</span>`;
  } else if (hint) {
    inner = `<span title="${esc(title)}">${inner}</span>`;
  }
  return inner;
}
// 切换显示模式（文件名 / 备注名），Q 键与工具栏按钮共用
function toggleDisplayMode() {
  toggleAliasMode();
  updateAliasModeBtn();
  refresh();
}
function updateAliasModeBtn() {
  const btn = document.getElementById('btn-alias-mode');
  if (!btn) return;
  btn.textContent = aliasMode() === 'alias' ? '备注名 (Q)' : '文件名 (Q)';
}

function selKeys() { return Array.from(selected); }
function relUrl(p) {
  // p 是真实路径，转 URL（反斜杠→正斜杠，逐段编码）
  const norm = p.replace(/\\/g, '/');
  return '/img/' + norm.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
function thumbUrl(p) {
  // 缩略图 URL：图片/视频/文档统一走 /api/thumb（服务端降采样 + 缓存）
  return '/api/thumb?path=' + encodeURIComponent(p) + '&size=256';
}
function encPath(p) { return p.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/'); }

// ---- 导航 ----
// 历史 = 视图快照列表；navIdx 指向当前显示的快照。
// 每个快照 = {path, tagIds}（目录 + 筛选标签），目录与筛选共用同一返回栈。
function _sameView(a, b) {
  if (!a || !b) return false;
  if (a.path !== b.path) return false;
  if ((a.tagIds || []).length !== (b.tagIds || []).length) return false;
  const sa = (a.tagIds || []).slice().sort();
  const sb = (b.tagIds || []).slice().sort();
  return sa.every((v, i) => v === sb[i]);
}
function _applyView(v) {
  currentPath = v.path || '';
  currentTagIds = (v.tagIds || []).slice();
  browseOffset = 0; browseType = 'all';
  refresh();
  if (typeof updateTagActive === 'function') updateTagActive();
  if (typeof expandToPath === 'function' && currentPath) expandToPath(currentPath);
}
function _pushView(path, tagIds) {
  const cur = navIdx >= 0 ? navHist[navIdx] : null;
  const v = {path: path || '', tagIds: (tagIds || []).slice()};
  if (_sameView(cur, v)) return;  // 去重：与当前一致不推
  navHist = navHist.slice(0, navIdx + 1);
  navHist.push(v);
  navIdx = navHist.length - 1;
  if (navHist.length > 100) { navHist.shift(); navIdx--; }
}
function navTo(path) {
  // 统一正斜杠，保证历史/比较一致
  if (path) path = path.replace(/\\/g, '/');
  // 目标已在历史中 → 直接跳回该位置（避免重复条目）
  const exist = navHist.findIndex(h => h.path === path);
  if (exist >= 0) {
    navIdx = exist;
    _applyView(navHist[exist]);
    return;
  }
  // 进目录 = 清空筛选（产品决策：目录是无筛选的物理位置浏览）
  _pushView(path, []);
  _applyView({path, tagIds: []});
}
function navBack() {
  // 回到上一个视图（navIdx 前移，恢复其 path + tagIds）
  if (navIdx > 0) {
    navIdx--;
    _applyView(navHist[navIdx]);
  }
}
function navForward() {
  if (navIdx < navHist.length - 1) {
    navIdx++;
    _applyView(navHist[navIdx]);
  }
}
function navUp() {
  if (!currentPath) return;
  const p = currentPath.replace(/[\\/]+$/, '');
  if (!p) return;
  // 已到盘符根（如 C: / C:/）或单段（无任何分隔符）→ 此电脑
  if (/^[A-Za-z]:$/.test(p) || !/[\\/]/.test(p)) {
    navTo('');
    return;
  }
  // 去掉最后一段（兼容 \ 与 /），统一输出正斜杠
  let upper = p.replace(/[\\/][^\\/]*$/, '').replace(/\\/g, '/');
  if (/^[A-Za-z]:$/.test(upper)) upper += '/';  // C: → C:/
  navTo(upper);
}
// 标签筛选变化时进历史：保持当前目录，记录新的 tagIds
function navToTag(tagIds) {
  _pushView(currentPath, tagIds);
}
function openFolder(rel) { navTo(rel); }

// ---- 地址栏 ----
function editAddress() {
  const bar = document.getElementById('address-bar');
  const input = document.createElement('input');
  input.value = currentPath;
  input.onkeydown = e => {
    if (e.key === 'Enter') {
      const val = input.value.trim();
      if (val) navTo(val.replace(/\/+$/, ''));
      renderAddress();
    }
    if (e.key === 'Escape') renderAddress();
  };
  input.onblur = renderAddress;
  bar.innerHTML = '';
  bar.appendChild(input);
  input.focus();
}
function renderAddress() {
  if (!currentPath) {
    addressText.innerHTML = '此电脑';
    addressText.title = '';
    return;
  }
  const parts = currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
  let html = '';
  let acc = '';
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    acc = i === 0 ? seg : acc + '/' + seg;
    const isLast = i === parts.length - 1;
    // 盘符段（C:）特殊处理
    const label = seg;
    if (isLast) {
      html += `<span class="crumb crumb-last" title="${currentPath}">${label}</span>`;
    } else {
      html += `<span class="crumb" data-crumb="${acc}" title="跳到 ${acc}">${label}</span><span class="crumb-sep">›</span>`;
    }
  }
  addressText.innerHTML = html;
  addressText.title = currentPath + '（点击编辑）';
  // 绑定面包屑点击
  addressText.querySelectorAll('.crumb[data-crumb]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      navTo(el.dataset.crumb);
    };
  });
}

// ---- 视图/排序 ----
function setView(mode) {
  viewMode = mode;
  document.getElementById('btn-view-grid').classList.toggle('active', mode === 'grid');
  document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');
  render();
}

// 排序菜单（上半字段 + 下半升降序）
function toggleSortMenu() {
  const panel = document.getElementById('sort-panel');
  if (panel.hidden) {
    panel.hidden = false;
    renderSortMenuActive();
  } else {
    panel.hidden = true;
  }
}
function renderSortMenuActive() {
  document.querySelectorAll('#sort-panel .sort-fields li').forEach(li => {
    li.classList.toggle('active', li.dataset.field === sortKey);
  });
  document.querySelectorAll('#sort-panel .sort-dir li').forEach(li => {
    li.classList.toggle('active', li.dataset.dir === sortDir);
  });
  const names = {name: '名称', mtime: '修改日期', type: '类型'};
  document.getElementById('sort-toggle-btn').textContent =
    (names[sortKey] || '名称') + (sortDir === 'desc' ? ' ↓' : ' ↑');
}
function setSortField(f) {
  if (f && f !== sortKey) sortKey = f;
  renderSortMenuActive();
  // 平铺模式：排序作用于平铺结果并重载，不走普通浏览 render()
  if (typeof flattenMode !== 'undefined' && flattenMode) {
    if (typeof flattenSetSort === 'function') flattenSetSort();
    return;
  }
  render();
}
function setSortDir(d) {
  sortDir = d;
  renderSortMenuActive();
  if (typeof flattenMode !== 'undefined' && flattenMode) {
    if (typeof flattenSetSort === 'function') flattenSetSort();
    return;
  }
  render();
}
document.addEventListener('mousedown', e => {
  const menu = document.getElementById('sort-menu');
  if (menu && !menu.contains(e.target)) document.getElementById('sort-panel').hidden = true;
});

// 网格缩放（五档：50/75/100/125/150%）分段按钮
const GRID_SIZES = ['45px', '68px', '90px', '112px', '135px'];
function setGridSize(idx) {
  idx = parseInt(idx);
  if (isNaN(idx)) idx = 2;
  if (idx < 0) idx = 0;
  if (idx > 4) idx = 4;
  const size = GRID_SIZES[idx];
  document.documentElement.style.setProperty('--grid-min-size', size);
  // 高亮当前挡位
  document.querySelectorAll('#scale-seg button').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.v) === idx);
  });
  localStorage.setItem('xibao_grid_size', String(idx));
}
function initGridSeg() {
  const seg = document.getElementById('scale-seg');
  if (!seg) return;
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button[data-v]');
    if (btn) setGridSize(btn.dataset.v);
  });
  loadGridSize();
}
function loadGridSize() {
  let idx = parseInt(localStorage.getItem('xibao_grid_size'));
  if (isNaN(idx)) idx = 2;
  if (idx < 0 || idx > 4) idx = 2;
  setGridSize(idx);
}

let lastSelIndex = -1;   // 上次选中的条目索引（用于 Shift 范围）
let orderedKeys = [];    // 当前渲染的条目顺序

// 统一选择处理：单击选中，Ctrl 切换，Shift 范围多选
function onItemClick(e, index, key, isFolder) {
  e.stopPropagation();
  if (e.ctrlKey || e.metaKey) {
    // Ctrl：切换单个选中
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    lastSelIndex = index;
  } else if (e.shiftKey && lastSelIndex >= 0) {
    // Shift：范围多选
    const a = Math.min(lastSelIndex, index);
    const b = Math.max(lastSelIndex, index);
    for (let i = a; i <= b; i++) {
      if (orderedKeys[i]) selected.add(orderedKeys[i]);
    }
  } else {
    // 单击：只选中这一个（Windows 风格）
    selected.clear();
    selected.add(key);
    lastSelIndex = index;
  }
  updateSelectionUI();
  e.preventDefault();
}

// 双击打开（Windows 风格）
function onItemDblClick(key, isFolder) {
  if (isFolder) openFolder(key);
  else openFile(key);
}

// 更新所有条目的选中高亮（只处理 selected 集合，避免全量扫描）
function updateSelectionUI() {
  const cells = document.querySelectorAll('.cell, .list-view tr');
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i].dataset.key;
    if (k) cells[i].classList.toggle('sel', selected.has(k));
  }
  // 异常模式下同步底部操作栏的"已选 N 项"
  if (typeof taskViewMode !== 'undefined' && taskViewMode === 'orphan' &&
      typeof renderOrphanActionBar === 'function') {
    renderOrphanActionBar();
  }
}

// ---- 数据加载 ----
async function refresh() {
  // 平铺模式下不走正常加载
  if (typeof flattenMode !== 'undefined' && flattenMode) {
    if (typeof loadFlatten === 'function') loadFlatten();
    return;
  }
  // 任务视图（待审核/标签异常）下不走正常加载，防止覆盖任务视图
  if (typeof taskViewMode !== 'undefined' && taskViewMode) {
    if (typeof refreshReviewView === 'function') refreshReviewView();
    return;
  }
  const params = new URLSearchParams();
  if (currentPath) params.set('path', currentPath);
  currentTagIds.forEach(t => params.append('tag_id', t));
  if (currentTagIds.length > 1 && typeof _filterRule !== 'undefined') params.set('rule', _filterRule);
  const lim = pageLimit();
  params.set('limit', lim);
  if (browseOffset > 0) params.set('offset', browseOffset);
  if (browseType && browseType !== 'all') params.set('type', browseType);
  const r = await fetch('/api/images?' + params.toString());
  data = await r.json();
  if (!data.ok) { itemGrid.innerHTML = `<p class="muted">加载失败: ${data.error || ''}</p>`; return; }
  renderAddress();
  render();
  if (typeof expandToPath === 'function') expandToPath(currentPath);
  // 大目录自动分页（目录浏览或标签筛选，total > limit 时显示导航+分页套件）
  if (data.total > lim) {
    browseRegister(lim, data.total);
  } else {
    browseUnregister();
  }
}

// ---- 普通浏览分页（大目录自动进入分页，全局；含类型过滤） ----
let browseOffset = 0;
let browseType = 'all';
function browseRegister(limit, total) {
  pgRegister('browse', {
    get: () => ({total, offset: browseOffset, limit, type: browseType}),
    prev: () => browseGo(browseOffset - limit),
    next: () => browseGo(browseOffset + limit),
    jump: (off) => browseGo(off),
    size: () => { browseOffset = 0; refresh(); },
  });
  renderBrowsePager();
}
function browseUnregister() {
  browseOffset = 0; browseType = 'all';
  if (typeof pgRemove === 'function') pgRemove('browse');
}
function browseGo(offset) {
  const maxOff = Math.max(0, ((data.total || 0) - 1));
  browseOffset = Math.max(0, Math.min(offset, maxOff));
  refresh();
  const body = document.getElementById('explorer-body');
  if (body) body.scrollTop = 0;
}
function browseSetType(t) {
  browseType = t;
  browseOffset = 0;
  refresh();
}
function renderBrowsePager() {
  pgRenderBanner('browse', {
    title: '📂 ' + (currentPath ? currentPath.split('/').filter(Boolean).pop() : '此电脑'),
    types: [['all', '全部'], ['image', '图片'], ['video', '视频'], ['document', '文档']],
    onType: 'browseSetType',
  });
  pgRenderBottom('browse');
}

let _allItems = [];
let _renderedCount = 0;
const BATCH = 60;          // 每批渲染条数
let _sentinel = null;

function render() {
  itemGrid.innerHTML = '';
  _listTable = null;
  if (!data) return;
  const folders = [...(data.folders || [])];
  const files = [...(data.files || [])];
  const items = [...folders.map(f => ({...f, isFolder: true})),
                 ...files.map(f => ({...f, isFolder: false}))];
  // 排序：文件夹永远在前，组内按字段+方向排
  const dirMul = sortDir === 'desc' ? -1 : 1;
  const getVal = it => {
    if (sortKey === 'mtime') return (it.mtime || '');
    if (sortKey === 'type') return it.isFolder ? '' : (it.type || '');
    return (displayName(it) || '').toLowerCase();
  };
  items.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const av = getVal(a), bv = getVal(b);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return cmp === 0 ? 0 : cmp * dirMul;
  });

  if (!items.length) {
    itemGrid.innerHTML = '<p class="muted" style="padding:40px;text-align:center">此处为空</p>';
    return;
  }
  orderedKeys = items.map(it => it.path);
  _allItems = items;
  _renderedCount = 0;
  renderMore();
  setupInfiniteScroll();
}

// 增量渲染：一次渲染一批，滚动到底部自动加载下一批
function renderMore() {
  const items = _allItems;
  const end = Math.min(_renderedCount + BATCH, items.length);
  if (_renderedCount >= end) return;
  const chunk = items.slice(_renderedCount, end);
  if (viewMode === 'list') appendListView(chunk, _renderedCount);
  else appendGridView(chunk, _renderedCount);
  _renderedCount = end;
}

function setupInfiniteScroll() {
  if (_sentinel) { _sentinel.remove(); _sentinel = null; }
  if (_renderedCount >= _allItems.length) return;
  _sentinel = document.createElement('div');
  _sentinel.className = 'scroll-sentinel';
  itemGrid.appendChild(_sentinel);
  if (_sentinelObserver) _sentinelObserver.disconnect();
  _sentinelObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      renderMore();
      if (_renderedCount >= _allItems.length && _sentinel) {
        _sentinelObserver.disconnect();
        _sentinel.remove(); _sentinel = null;
      }
    }
  }, {root: document.getElementById('explorer-body'), rootMargin: '200px'});
  _sentinelObserver.observe(_sentinel);
}
let _sentinelObserver = null;

function appendGridView(chunk, startIdx) {
  itemGrid.className = 'grid-view';
  for (let i = 0; i < chunk.length; i++) {
    const it = chunk[i];
    const idx = startIdx + i;
    const div = document.createElement('div');
    div.className = 'cell cell-' + (it.isFolder ? 'folder' : 'file') + (selected.has(it.path) ? ' sel' : '');
    div.draggable = true;
    let display = '';
    if (it.isFolder) {
      display = it.preview && it.preview.length
        ? `<div class="folder-preview ${it.preview.length === 1 ? 'single' : ''}"><div class="fp-grid">${it.preview.slice(0,4).map(p=>`<img src="${thumbUrl(p)}" loading="lazy">`).join('')}</div></div>`
        : `<div class="cell-icon">📁</div>`;
    } else if (it.type === 'image') {
      // 图片：走缩略图降采样，避免网格加载原图（大图/数千像素卡顿根源）
      display = `<img class="cell-thumb" src="${thumbUrl(it.path)}" loading="lazy">`;
    } else if (it.type === 'video') {
      // 视频：尝试系统缩略图，失败回退图标
      display = `<img class="cell-thumb video-thumb" src="${thumbUrl(it.path)}" loading="lazy">`;
    } else if (it.type === 'doc' || it.type === 'pdf' || it.type === 'archive' || it.type === 'code') {
      // 文档/PDF/压缩包/代码：尝试系统 COM 缩略图（PSD/Office/PDF 有效），失败回退图标
      display = `<img class="cell-thumb doc-thumb" src="${thumbUrl(it.path)}" loading="lazy">`;
    } else {
      display = fileIconHtml(it.name, 'cell-icon-img', 'cell-icon', iconOf(it.type), it.path);
    }
    const meta = it.isFolder ? `${it.file_count} 项` : fmtSize(it.size);
    div.innerHTML = `<div class="cell-content">${display}</div><div class="cell-name">${nameHtml(it)}</div><div class="cell-meta">${meta}</div>`;
    // 缩略图加载失败 → 回退图标
    const vt = div.querySelector('.cell-thumb');
    if (vt) vt.onerror = () => {
      vt.outerHTML = fileIconHtml(it.name, 'cell-icon-img', 'cell-icon', iconOf(it.type), it.path);
    };
    div.dataset.key = it.path;
    div.onclick = e => onItemClick(e, idx, it.path, it.isFolder);
    div.ondblclick = e => { e.stopPropagation(); onItemDblClick(it.path, it.isFolder); };
    div.oncontextmenu = e => showCtx(e, it.path, it.isFolder ? 'folder' : 'file', it.type);
    div.ondragstart = e => { e.dataTransfer.setData('text/plain', JSON.stringify([{path: it.path, kind: it.isFolder ? 'folder' : 'file'}])); };
    itemGrid.appendChild(div);
  }
}

let _listTable = null;
function appendListView(chunk, startIdx) {
  if (!_listTable) {
    itemGrid.className = '';
    _listTable = document.createElement('table');
    _listTable.className = 'list-view';
    _listTable.innerHTML = `<thead><tr>
      <th>名称</th><th>类型</th><th>大小</th><th>修改时间</th></tr></thead>`;
    itemGrid.appendChild(_listTable);
  }
  let tbody = _listTable.querySelector('tbody');
  if (!tbody) { tbody = document.createElement('tbody'); _listTable.appendChild(tbody); }
  for (let i = 0; i < chunk.length; i++) {
    const it = chunk[i];
    const idx = startIdx + i;
    const tr = document.createElement('tr');
    tr.className = selected.has(it.path) ? 'sel' : '';
    tr.dataset.key = it.path;
    tr.draggable = true;
    let iconHtml;
    if (it.isFolder) iconHtml = '<span class="list-icon">📁</span>';
    else if (it.type === 'image') iconHtml = `<img class="list-icon-img" src="${relUrl(it.path)}">`;
    else {
      iconHtml = fileIconHtml(it.name, 'list-icon-img', 'list-icon', iconOf(it.type), it.path);
    }
    tr.innerHTML = `<td>${iconHtml} ${nameHtml(it)}</td>
      <td>${it.isFolder ? '文件夹' : it.type}</td>
      <td>${it.isFolder ? '-' : fmtSize(it.size)}</td>
      <td>${(it.mtime || '').replace('T', ' ').slice(0, 16)}</td>`;
    tr.onclick = e => onItemClick(e, idx, it.path, it.isFolder);
    tr.ondblclick = e => { e.stopPropagation(); onItemDblClick(it.path, it.isFolder); };
    tr.oncontextmenu = e => showCtx(e, it.path, it.isFolder ? 'folder' : 'file', it.type);
    tr.ondragstart = e => { e.dataTransfer.setData('text/plain', JSON.stringify([{path: it.path, kind: it.isFolder ? 'folder' : 'file'}])); };
    tbody.appendChild(tr);
  }
}

function fmtSize(n) {
  if (!n && n !== 0) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

// ---- 打开文件 ----
async function openFile(key) {
  const r = await fetch('/api/file/open', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key})});
  const d = await r.json();
  if (!d.ok) alert(d.error || '打开失败');
}

async function openInSystemExplorer() {
  if (!currentPath) { alert('请先进入一个目录'); return; }
  const r = await fetch('/api/file/explorer', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: currentPath})});
  const d = await r.json();
  if (!d.ok) alert(d.error || '打开失败');
}

let aliasModalPath = null;
function ctxSetAlias(optPath) {
  hideContextMenus();
  const c = optPath ? {path: optPath} : currentCtx();
  if (!c) return;
  aliasModalPath = c.path;
  document.getElementById('alias-modal-target').textContent = '目标：' + (c.path.split(/[\\/]/).pop());
  const input = document.getElementById('alias-modal-input');
  input.value = '';
  // 读取现有备注名
  fetch('/api/alias/' + encPath(c.path))
    .then(r => r.json())
    .then(d => { if (d.ok && d.alias) input.value = d.alias; })
    .catch(() => {});
  modalShow(document.getElementById('alias-modal'));
  setTimeout(() => input.focus(), 100);
}
async function saveAliasModal() {
  const input = document.getElementById('alias-modal-input');
  const alias = input.value.trim();
  if (!aliasModalPath) return;
  try {
    const r = await fetch('/api/alias', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: aliasModalPath, alias})});
    const d = await r.json();
    if (!d.ok) { alert('保存失败: ' + (d.error || '')); return; }
  } catch (e) { alert('保存失败: ' + e.message); return; }
  closeAliasModal();
  refresh();
}
async function clearAliasModal() {
  if (!aliasModalPath) return;
  try {
    await fetch('/api/alias', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: aliasModalPath, alias: ''})});
  } catch (e) { /* 忽略 */ }
  closeAliasModal();
  refresh();
}
function closeAliasModal() {
  modalHide(document.getElementById('alias-modal'));
  aliasModalPath = null;
}

function ctxOpenFolder() {
  hideContextMenus();
  if (!ctxItem) return;
  // 在软件内打开所在文件夹：文件取父目录，文件夹打开自身
  const target = ctxItem.kind === 'folder' ? ctxItem.path : ctxItem.path.replace(/[\\/][^\\/]*$/, '');
  if (!target) return;
  openFolder(target);
}
function ctxDelete() {
  hideContextMenus();
  const items = selected.size ? selKeys() : (ctxItem ? [ctxItem.path] : []);
  if (!items.length) return;
  if (!confirm(`确认删除选中的 ${items.length} 项？将移入回收站，可恢复。`)) return;
  doDelete(items);
}
function ctxAttr() {
  hideContextMenus();
  if (selected.size > 1) openMultiAttrModal(selKeys());
  else {
    const c = currentCtx();
    if (c) openAttrModal(c.path);
  }
}

// ---- 删除 ----
async function doDelete(paths) {
  const r = await fetch('/api/images/delete', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({paths})});
  const d = await r.json();
  if (!d.ok) alert('删除失败: ' + (d.error || ''));
  selected.clear();
  refresh(); loadFileTree();
}

// ---- 属性 ----
async function openAttrModal(path) {
  const [attrRes, tagRes, aliasRes] = await Promise.all([
    fetch('/api/library/attr?key=' + encodeURIComponent(path)),
    fetch('/api/folders/' + encPath(path) + '/tags'),
    fetch('/api/alias/' + encPath(path)),
  ]);
  const d = await attrRes.json();
  const tags = (await tagRes.json()).tags || [];
  const alias = (await aliasRes.json()).alias || '';
  const bodyEl = document.getElementById('attr-body');
  if (!d.ok) { bodyEl.innerHTML = '<p class="muted">' + (d.error || '无法读取') + '</p>'; }
  else {
    // 只渲染"终端标签"（用户实际勾选、无子级在集合中），每条带完整祖先链，避免父级平铺冗余
    const tagIds = new Set(tags.map(t => t.id));
    const terminals = tags.filter(t => !tags.some(o => o.parent_id === t.id));
    const chainOf = (tid) => {
      const chain = [];
      let cur = tid;
      const seen = new Set();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const t = allTags.find(x => x.id === cur);
        if (!t) break;
        chain.unshift(t.name);
        cur = t.parent_id || 0;
      }
      return chain.join(' > ');
    };
    const capsules = terminals.map(t => {
      const color = t.color || '#ececec';
      return `<span class="tag-capsule" data-tagid="${t.id}" style="background:${color}" title="点击筛选">${chainOf(t.id)}</span>`;
    }).join('');
    bodyEl.innerHTML = `
      <div class="attr-row"><span>名称</span><span>${path.split(/[\\/]/).pop()}</span></div>
      <div class="attr-row"><span>备注名</span><span><span class="attr-alias" style="cursor:pointer;color:#0b57d0">${alias ? `<span class="alias-name" style="background:${aliasBg()}">${alias}</span>` : '（未设置，点击设置）'}</span></span></div>
      <div class="attr-row"><span>完整路径</span><span>${d.abs_path}</span></div>
      <div class="attr-row"><span>标签</span><span class="attr-tags">${capsules || '<span class="muted">（无标签）</span>'}</span></div>`;
    // 胶囊点击 → 直达标签筛选
    bodyEl.querySelectorAll('.tag-capsule').forEach(el => {
      el.onclick = () => {
        closeAttrModal();
        selectTag(parseInt(el.dataset.tagid));
      };
    });
    // 备注名行点击 → 打开编辑浮窗
    bodyEl.querySelectorAll('.attr-alias').forEach(el => {
      el.onclick = () => { ctxSetAlias(path); };
    });
  }
  modalShow(document.getElementById('attr-modal'));
}
function closeAttrModal() { modalHide(document.getElementById('attr-modal')); }

// ---- 多选属性：并集/交集摘要 + 逐项列出 ----
async function openMultiAttrModal(paths) {
  const bodyEl = document.getElementById('attr-body');
  bodyEl.innerHTML = '<p class="muted">加载中…</p>';
  modalShow(document.getElementById('attr-modal'));
  const items = [];
  try {
    // 并发取每个路径的属性与标签
    const results = await Promise.all(paths.map(async (p) => {
      const [attrRes, tagRes] = await Promise.all([
        fetch('/api/library/attr?key=' + encodeURIComponent(p)),
        fetch('/api/folders/' + encPath(p) + '/tags'),
      ]);
      const a = await attrRes.json();
      const t = (await tagRes.json()).tags || [];
      return {name: p.split(/[\\/]/).pop() || p, ok: a.ok, abs_path: a.abs_path, tags: t, size: a.size || 0};
    }));
    items.push(...results);
  } catch (e) {
    bodyEl.innerHTML = '<p class="muted">读取失败: ' + (e.message || e) + '</p>';
    return;
  }
  // 计算交集（所有项共有）与并集（任一有）
  const allTagIds = new Set();
  const common = new Map();
  items.forEach((it, idx) => {
    const ids = new Set(it.tags.map(t => t.id));
    ids.forEach(id => allTagIds.add(id));
    if (idx === 0) ids.forEach(id => common.set(id, true));
    else {
      common.forEach((_, id) => { if (!ids.has(id)) common.delete(id); });
    }
  });
  // 并集/交集：从所有文件的标签池按 id 聚合（不能用 items[0] 过滤，会漏掉其他项独有标签）
  const tagById = new Map();
  items.forEach(it => it.tags.forEach(t => { if (!tagById.has(t.id)) tagById.set(t.id, t); }));
  const commonTags = items.length ? items[0].tags.filter(t => common.has(t.id)) : [];
  const unionTags = items.length ? Array.from(tagById.values()).filter(t => allTagIds.has(t.id)) : [];
  // 摘要胶囊（不带颜色，纯文本；并集去重按 id）
  const unionCaps = unionTags.map(t => `<span class="tag-capsule plain">${t.name}</span>`).join('') || '<span class="muted">（无）</span>';
  const commonCaps = commonTags.map(t => `<span class="tag-capsule plain">${t.name}</span>`).join('') || '<span class="muted">（无共同标签）</span>';
  // 文件总计大小（文件夹 size=0，不参与合计）
  const totalSize = items.reduce((s, it) => s + (it.size || 0), 0);
  bodyEl.innerHTML = `
    <div class="attr-row"><span>选中条目</span><span>${items.length} 项${totalSize > 0 ? ' · 共 ' + fmtSize(totalSize) : ''}</span></div>
    <div class="attr-row"><span>共同标签</span><span class="attr-tags">${commonCaps}</span></div>
    <div class="attr-row"><span>全部标签</span><span class="attr-tags">${unionCaps}</span></div>`;
}

// 初始化显示模式按钮文案（页面加载后执行）
updateAliasModeBtn();

