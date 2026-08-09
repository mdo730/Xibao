// 西煲 - Win11 风格资源管理器
const itemGrid = document.getElementById('item-grid');
const addressText = document.getElementById('address-text');
const tagTreeEl = document.getElementById('tag-tree');
const fileTreeEl = document.getElementById('file-tree');

let currentPath = '';
let currentTagIds = [];
let selectMode = false;
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
const UNTAGGED_ID = -1;

const TYPE_ICON = {folder:'📁', image:'🖼', video:'🎬', audio:'🎵', pdf:'📕', doc:'📄', archive:'🗜', code:'💻', other:'📄'};
function iconOf(t) { return TYPE_ICON[t] || '📄'; }

function selKeys() { return Array.from(selected); }
function relUrl(p) {
  // p 是真实路径，转 URL（反斜杠→正斜杠，逐段编码）
  const norm = p.replace(/\\/g, '/');
  return '/img/' + norm.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
function encPath(p) { return p.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent).join('/'); }

// ---- 导航 ----
function pushHist() {
  if (navIdx >= 0 && navHist[navIdx] === currentPath) return;
  navHist = navHist.slice(0, navIdx + 1);
  navHist.push(currentPath);
  navIdx = navHist.length - 1;
}
function navTo(path) { pushHist(); currentPath = path; currentTagIds = []; refresh(); }
function navBack() { if (navIdx > 0) { navIdx--; currentPath = navHist[navIdx]; currentTagIds = []; refresh(); } }
function navForward() { if (navIdx < navHist.length - 1) { navIdx++; currentPath = navHist[navIdx]; currentTagIds = []; refresh(); } }
function navUp() {
  if (!currentPath) return;
  const parts = currentPath.split('/').filter(Boolean);
  if (parts.length <= 1) navTo('');
  else navTo(parts.slice(0, -1).join('/'));
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
    const label = (seg.length === 2 && seg[1] === ':') ? seg : seg;
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
  render();
}
function setSortDir(d) {
  sortDir = d;
  renderSortMenuActive();
  render();
}
document.addEventListener('mousedown', e => {
  const menu = document.getElementById('sort-menu');
  if (menu && !menu.contains(e.target)) document.getElementById('sort-panel').hidden = true;
});

// 网格缩放（五档：50/75/100/125/150%）分段按钮
const GRID_SIZES = ['45px', '68px', '90px', '112px', '135px'];
const GRID_PERCENT = [50, 75, 100, 125, 150];
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

function toggleSel(key) {
  if (selected.has(key)) selected.delete(key); else selected.add(key);
  render();
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
}

// ---- 数据加载 ----
async function refresh() {
  const params = new URLSearchParams();
  if (currentPath) params.set('path', currentPath);
  currentTagIds.forEach(t => params.append('tag_id', t));
  if (currentTagIds.length > 1 && typeof _filterRule !== 'undefined') params.set('rule', _filterRule);
  params.set('limit', 500);  // 大目录分批，避免卡顿
  const r = await fetch('/api/images?' + params.toString());
  data = await r.json();
  if (!data.ok) { itemGrid.innerHTML = `<p class="muted">加载失败: ${data.error || ''}</p>`; return; }
  renderAddress();
  render();
  if (typeof expandToPath === 'function') expandToPath(currentPath);
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
    return (it.name || '').toLowerCase();
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
  if (data.truncated) {
    const tip = document.createElement('div');
    tip.className = 'muted';
    tip.style.textAlign = 'center';
    tip.style.padding = '12px';
    tip.textContent = '目录较大，仅显示前 500 项。建议用右上角 🪟 在系统资源管理器中浏览。';
    itemGrid.appendChild(tip);
  }
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
        ? `<div class="folder-preview ${it.preview.length === 1 ? 'single' : ''}"><div class="fp-grid">${it.preview.slice(0,4).map(p=>`<img src="${relUrl(p)}" loading="lazy">`).join('')}</div></div>`
        : `<div class="cell-icon">📁</div>`;
    } else if (it.type === 'image') {
      display = `<img class="cell-thumb" src="${relUrl(it.path)}" loading="lazy">`;
    } else {
      display = fileIconHtml(it.name, 'cell-icon-img', 'cell-icon', iconOf(it.type));
    }
    const meta = it.isFolder ? `${it.file_count} 项` : fmtSize(it.size);
    div.innerHTML = `<div class="cell-content">${display}</div><div class="cell-name">${it.name}</div><div class="cell-meta">${meta}</div>`;
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
      iconHtml = fileIconHtml(it.name, 'list-icon-img', 'list-icon', iconOf(it.type));
    }
    tr.innerHTML = `<td>${iconHtml} ${it.name}</td>
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

// ---- 框选（marquee） ----
let _marquee = null;
let _marqueeStart = null;
let _marqueeEl = null;
function initMarquee() {
  const bodyEl = document.getElementById('explorer-body');
  _marqueeEl = document.createElement('div');
  _marqueeEl.className = 'marquee-box';
  _marqueeEl.style.display = 'none';
  bodyEl.appendChild(_marqueeEl);
  bodyEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.cell') || e.target.closest('tr') || e.target.closest('.scroll-sentinel')) return;
    _marqueeStart = {x: e.clientX, y: e.clientY};
    _marquee = {x: e.clientX, y: e.clientY, w: 0, h: 0};
    _marqueeEl.style.display = 'block';
    updateMarquee();
  });
  document.addEventListener('mousemove', e => {
    if (!_marquee || !_marqueeStart) return;
    _marquee = {
      x: Math.min(e.clientX, _marqueeStart.x),
      y: Math.min(e.clientY, _marqueeStart.y),
      w: Math.abs(e.clientX - _marqueeStart.x),
      h: Math.abs(e.clientY - _marqueeStart.y),
    };
    updateMarquee();
  });
  document.addEventListener('mouseup', () => {
    if (!_marquee) return;
    const wasClick = _marquee.w < 4 && _marquee.h < 4;
    _marqueeEl.style.display = 'none';
    _marquee = null; _marqueeStart = null;
    if (wasClick) {
      // 点击空白：取消所有选择
      selected.clear();
      updateSelectionUI();
    }
  });
}
function updateMarquee() {
  _marqueeEl.style.display = 'block';
  _marqueeEl.style.left = _marquee.x + 'px';
  _marqueeEl.style.top = _marquee.y + 'px';
  _marqueeEl.style.width = _marquee.w + 'px';
  _marqueeEl.style.height = _marquee.h + 'px';
  if (_marquee.w < 4 && _marquee.h < 4) return; // 太小当作点击
  // 计算与哪些 cell 相交
  selected.clear();
  const rect = {x: _marquee.x, y: _marquee.y, w: _marquee.w, h: _marquee.h};
  document.querySelectorAll('.cell, .list-view tr').forEach(el => {
    const r = el.getBoundingClientRect();
    const overlap = !(r.right < rect.x || r.left > rect.x + rect.w || r.bottom < rect.y || r.top > rect.y + rect.h);
    if (overlap && el.dataset.key) selected.add(el.dataset.key);
    el.classList.toggle('sel', selected.has(el.dataset.key));
  });
}
initMarquee();

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

// ---- 右键菜单 ----
function showCtx(e, path, kind, type) {
  e.preventDefault();
  ctxItem = {path, kind, type};
  // Windows 风格：右键未选中项 → 只选中它；右键已选中项 → 保持多选
  if (!selected.has(path)) {
    selected.clear();
    selected.add(path);
    updateSelectionUI();
  }
  const menu = document.getElementById('ctx-menu');
  const isMulti = selected.size > 1;
  let html = isMulti ? '<div onclick="ctxTag()">追加标签… <span class="ctx-key">E</span></div>' : '<div onclick="ctxTag()">编辑标签… <span class="ctx-key">E</span></div>';
  html += '<div onclick="ctxClearTags()">清除标签</div>';
  if (kind === 'folder') html += '<div onclick="ctxAddQuick()">⭐ 添加到快速访问</div>';
  if (kind === 'file') html += '<div onclick="ctxOpen()">打开</div>';
  html += '<div onclick="ctxOpenFolder()">打开所在文件夹</div>';
  html += '<div onclick="ctxRename()">重命名 <span class="ctx-key">F2</span></div>';
  html += '<div onclick="ctxDelete()">删除</div>';
  html += '<div onclick="ctxAttr()">属性 <span class="ctx-key">F</span></div>';
  menu.innerHTML = html;
  menu.classList.remove('hidden');
  menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - 200) + 'px';
}
function hideContextMenus() {
  document.getElementById('ctx-menu').classList.add('hidden');
  document.getElementById('tag-ctx-menu').classList.add('hidden');
  const sm = document.getElementById('scheme-ctx-menu');
  if (sm) sm.classList.add('hidden');
  // jsTree 自带右键菜单
  if (window.$.vakata && $.vakata.context) $.vakata.context.hide();
}
// 点击/右键任意处若不在菜单内则关闭菜单（capture 阶段，防 stopPropagation）
document.addEventListener('mousedown', e => {
  const cm = document.getElementById('ctx-menu');
  const tcm = document.getElementById('tag-ctx-menu');
  const sm = document.getElementById('scheme-ctx-menu');
  const vakata = document.querySelector('.vakata-context');
  const inCtx = cm.contains(e.target);
  const inTagCtx = tcm.contains(e.target);
  const inScheme = sm && sm.contains(e.target);
  const inVakata = vakata && vakata.contains(e.target);
  // 点击 jsTree 自身右键菜单项时不关闭（避免打断 action）
  if (!inCtx && !inTagCtx && !inScheme && !inVakata) hideContextMenus();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenus(); });
document.addEventListener('scroll', () => { hideContextMenus(); }, true);
// 方案右键菜单：鼠标移出自动关闭
(function () {
  const sm = document.getElementById('scheme-ctx-menu');
  if (sm) sm.addEventListener('mouseleave', () => sm.classList.add('hidden'));
})();
// 当前操作目标：右键设的 ctxItem，否则取选中项（供键盘快捷键用）
function currentCtx() {
  if (ctxItem) return ctxItem;
  if (selected.size) {
    const k = selKeys()[0];
    const it = _allItems.find(x => x.path === k);
    return {path: k, kind: it && it.isFolder ? 'folder' : 'file'};
  }
  return null;
}
function ctxTag() {
  hideContextMenus();
  if (selected.size > 1) openTagModal(selKeys(), 'multi', 'add');
  else {
    const c = currentCtx();
    if (c) openTagModal([c.path], c.kind, 'set');
  }
}
async function ctxClearTags() {
  hideContextMenus();
  // 多选清全部选中项，单选清右键目标项
  const items = selected.size > 1 ? selKeys() : (ctxItem ? [ctxItem.path] : []);
  if (!items.length) return;
  const name = ctxItem ? ctxItem.path.split(/[\\/]/).pop() : '';
  const label = items.length > 1 ? `确认清除选中的 ${items.length} 项的所有标签标记？此操作不可恢复。` : `确认清除「${name}」的所有标签标记？此操作不可恢复。`;
  if (!confirm(label)) return;
  for (const p of items) {
    try {
      await fetch('/api/folders/' + encPath(p) + '/tags', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({tag_ids: []}),
      });
    } catch (e) { /* 单条失败继续 */ }
  }
  loadTags(); refresh();
}
function ctxOpen() {
  hideContextMenus(); if (ctxItem && ctxItem.kind === 'file') openFile(ctxItem.path); }
function ctxAddQuick() {
  hideContextMenus();
  if (!ctxItem || ctxItem.kind !== 'folder') return;
  if (typeof addToQuickAccess === 'function') addToQuickAccess(ctxItem.path);
}
async function ctxRename() {
  hideContextMenus();
  if (!ctxItem) return;
  const name = prompt('新名称：', ctxItem.path.split('/').pop());
  if (!name || !name.trim()) return;
  const r = await fetch('/api/file/rename', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: ctxItem.path, new_name: name.trim()})});
  const d = await r.json();
  if (!d.ok) { alert('重命名失败: ' + (d.error || '')); return; }
  refresh(); loadFileTree();
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
  const [attrRes, tagRes] = await Promise.all([
    fetch('/api/library/attr?key=' + encodeURIComponent(path)),
    fetch('/api/folders/' + encPath(path) + '/tags'),
  ]);
  const d = await attrRes.json();
  const tags = (await tagRes.json()).tags || [];
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
      <div class="attr-row"><span>完整路径</span><span>${d.abs_path}</span></div>
      <div class="attr-row"><span>标签</span><span class="attr-tags">${capsules || '<span class="muted">（无标签）</span>'}</span></div>`;
    // 胶囊点击 → 直达标签筛选
    bodyEl.querySelectorAll('.tag-capsule').forEach(el => {
      el.onclick = () => {
        closeAttrModal();
        selectTag(parseInt(el.dataset.tagid));
      };
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
      return {name: p.split(/[\\/]/).pop() || p, ok: a.ok, abs_path: a.abs_path, tags: t};
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
  const commonTags = items.length ? items[0].tags.filter(t => common.has(t.id)) : [];
  const unionTags = items.length ? items[0].tags.filter(t => allTagIds.has(t.id)) : [];
  // 摘要胶囊（不带颜色，纯文本；并集去重按 id）
  const unionCaps = unionTags.map(t => `<span class="tag-capsule plain">${t.name}</span>`).join('') || '<span class="muted">（无）</span>';
  const commonCaps = commonTags.map(t => `<span class="tag-capsule plain">${t.name}</span>`).join('') || '<span class="muted">（无共同标签）</span>';
  const rows = items.map(it => {
    const terminalTags = it.tags.filter(t => !it.tags.some(o => o.parent_id === t.id));
    const tagText = terminalTags.map(t => t.name).join('、') || '（无标签）';
    return `<div class="attr-row"><span>${it.name}</span><span class="attr-tags">${tagText}</span></div>`;
  }).join('');
  bodyEl.innerHTML = `
    <div class="attr-row"><span>选中条目</span><span>${items.length} 项</span></div>
    <div class="attr-row"><span>共同标签</span><span class="attr-tags">${commonCaps}</span></div>
    <div class="attr-row"><span>全部标签</span><span class="attr-tags">${unionCaps}</span></div>
    <hr class="attr-divider">
    ${rows}`;
}

