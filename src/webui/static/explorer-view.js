// ---- 视图/排序（自 explorer-core.js 拆分）----
// 依赖全局：viewMode/sortKey/sortDir（core）、data（core）、flattenMode（flatten.js）
// 加载顺序：必须在 explorer-core.js 之后

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