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
