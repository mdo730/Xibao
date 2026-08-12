// ---- 筛选方案（localStorage 持久化 + SortableJS 拖拽） ----
const SCHEMES_KEY = 'xibao_filter_schemes';

// 小浮窗开关
function toggleSchemesDrawer() { openSchemesFloat(); }
function openSchemesFloat() {
  const f = document.getElementById('schemes-float');
  if (!f) return;
  f.classList.remove('hidden');
  renderSchemes();
  bringSchemesFront();
}
function closeSchemesFloat() {
  const f = document.getElementById('schemes-float');
  if (f) f.classList.add('hidden');
}
// 浮窗拖动（标题栏）
function initSchemesDrag() {
  const f = document.getElementById('schemes-float');
  const head = document.getElementById('schemes-float-head');
  if (!f || !head) return;
  head.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = f.offsetLeft, origY = f.offsetTop;
    function onMove(ev) {
      f.style.left = (origX + ev.clientX - startX) + 'px';
      f.style.top = (origY + ev.clientY - startY) + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
function bringSchemesFront() {
  const f = document.getElementById('schemes-float');
  if (f) f.style.zIndex = 500;
}

function loadSchemes() {
  try { return JSON.parse(localStorage.getItem(SCHEMES_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveSchemes(list) {
  try { localStorage.setItem(SCHEMES_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
}

function renderSchemes() {
  const listEl = document.getElementById('schemes-list');
  if (!listEl) return;
  const list = loadSchemes();
  listEl.innerHTML = '';
  if (!list.length) {
    listEl.innerHTML = '<div class="scheme-empty">点 + 保存当前筛选</div>';
    return;
  }
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const div = document.createElement('div');
    div.className = 'scheme-item';
    div.dataset.idx = i;
    const dotColor = s.color || '#ecc889';
    div.innerHTML = `
      <span class="scheme-drag">⠿</span>
      <span class="scheme-dot" style="background:${dotColor}"></span>
      <span class="scheme-name">${s.name}</span>`;
    div.title = s.tags.map(tid => tagName(tid)).filter(Boolean).join('、') || '（无标签）';
    // 点击应用方案
    div.addEventListener('click', e => {
      if (e.target.closest('.scheme-drag') || e.target.closest('.scheme-dot')) return;
      applyScheme(i);
    });
    // 右键菜单
    div.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      schemeCtxIdx = i;
      const menu = document.getElementById('scheme-ctx-menu');
      menu.innerHTML = '<div onclick="schemeEdit()">编辑方案…</div>' +
        '<div onclick="schemeRename()">重命名…</div>' +
        '<div onclick="schemeColor()">设置颜色…</div>' +
        '<div onclick="schemeDelete()">删除</div>';
      menu.classList.remove('hidden');
      menu.style.left = Math.min(e.clientX, window.innerWidth - 150) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 140) + 'px';
    });
    listEl.appendChild(div);
  }
  // SortableJS 拖拽排序
  if (window.Sortable) {
    if (listEl._sortable) listEl._sortable.destroy();
    listEl._sortable = new Sortable(listEl, {
      handle: '.scheme-drag',
      animation: 150,
      onEnd: evt => {
        const arr = loadSchemes();
        const [moved] = arr.splice(evt.oldIndex, 1);
        arr.splice(evt.newIndex, 0, moved);
        saveSchemes(arr);
        renderSchemes();
      },
    });
  }
}

let schemeCtxIdx = -1;

// 保存当前筛选为方案
function saveCurrentScheme() {
  // 当前筛选集合（无论正常/筛选模式，都是 currentTagIds）
  const ids = (currentTagIds || []).slice();
  const list = loadSchemes();
  let n = 1;
  const names = new Set(list.map(x => x.name));
  while (names.has('方案' + n)) n++;
  const scheme = {name: '方案' + n, tags: ids, color: '#ecc889'};
  list.push(scheme);
  saveSchemes(list);
  renderSchemes();
  // 新建后立即行内重命名
  setTimeout(() => {
    const items = document.querySelectorAll('.scheme-item');
    const last = items[items.length - 1];
    if (last) schemeInlineEdit(last);
  }, 100);
}

// 行内编辑方案名
function schemeInlineEdit(itemEl) {
  const nameEl = itemEl.querySelector('.scheme-name');
  if (!nameEl) return;
  const old = nameEl.textContent;
  const input = document.createElement('input');
  input.className = 'scheme-input';
  input.value = old;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      commitSchemeRename(itemEl, input.value);
    } else if (e.key === 'Escape') {
      nameEl.textContent = old;
      renderSchemes();
    }
  });
  input.addEventListener('blur', () => commitSchemeRename(itemEl, input.value));
  nameEl.replaceWith(input);
  input.focus();
  input.select();
}
function commitSchemeRename(itemEl, val) {
  const idx = parseInt(itemEl.dataset.idx);
  const list = loadSchemes();
  const s = list[idx];
  if (s) {
    s.name = (val || '').trim() || s.name;
    saveSchemes(list);
  }
  renderSchemes();
}

function schemeEdit() {
  hideContextMenus();
  if (schemeCtxIdx < 0) return;
  const list = loadSchemes();
  const s = list[schemeCtxIdx];
  if (!s) return;
  editSchemeTarget = schemeCtxIdx;
  openEditSchemeModal(s);
}
let editSchemeTarget = -1;
// 编辑方案：用打标签弹窗勾选该方案包含的标签
function openEditSchemeModal(scheme) {
  document.getElementById('tag-modal-title').textContent = '编辑方案：' + scheme.name;
  const tags = (scheme.tags || []).slice();
  // 统一用 renderTagOptionTree（destroy 重建 + 勾选，避免 refresh 竞态；leafOnly 父级不可勾选）
  renderTagOptionTree('#tag-modal-list', tags, true);
  modalShow(document.getElementById('tag-modal'));
}

function schemeRename() {
  hideContextMenus();
  if (schemeCtxIdx < 0) return;
  const items = document.querySelectorAll('.scheme-item');
  const el = items[schemeCtxIdx];
  if (el) schemeInlineEdit(el);
}

function schemeColor() {
  hideContextMenus();
  if (schemeCtxIdx < 0) return;
  const list = loadSchemes();
  const s = list[schemeCtxIdx];
  if (!s) return;
  schemeColorTarget = schemeCtxIdx;
  selColor = s.color || '#ecc889';
  document.getElementById('tag-color-title').textContent = '设置方案「' + s.name + '」颜色';
  const palette = document.getElementById('tag-color-palette');
  palette.innerHTML = '';
  const colors = (typeof PALETTE !== 'undefined') ? PALETTE : [
    '#ecc889', '#f0c6c6', '#f5d9a8', '#d9f0c6', '#c6e8f0',
    '#d9c6f0', '#f0e0c6', '#c6f0d9', '#f0c6e0', '#c6c6f0',
    '#f5f5dc', '#ffd700', '#ff8c00', '#ff6347', '#32cd32',
    '#00bfff', '#9370db', '#ff69b4', '#a9a9a9', '#000000',
  ];
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === selColor ? ' sel' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.onclick = () => {
      selColor = c;
      palette.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('sel'));
      sw.classList.add('sel');
      updateColorPreview();
    };
    palette.appendChild(sw);
  });
  updateColorPreview();
  modalShow(document.getElementById('tag-color-modal'));
  // 复用 saveTagColor 逻辑，但改保存到方案
}
let schemeColorTarget = -1;

function schemeDelete() {
  hideContextMenus();
  if (schemeCtxIdx < 0) return;
  if (!confirm('删除该筛选方案？')) return;
  const list = loadSchemes();
  list.splice(schemeCtxIdx, 1);
  saveSchemes(list);
  renderSchemes();
}

function applyScheme(idx) {
  const list = loadSchemes();
  const s = list[idx];
  if (!s) return;
  currentTagIds = (s.tags || []).slice();
  currentPath = '';
  navToTag(currentTagIds);
  // 进入筛选模式展示多选集合 + chips
  _filterMode = true;
  const btn = document.getElementById('btn-filter-mode');
  if (btn) btn.classList.add('active');
  const tree = $('#tag-tree').data('jstree');
  if (tree) { tree.settings.core.multiple = true; tree.refresh(); }
  renderFilterChips();
  refresh();
  updateTagActive();
}

// 初始化方案右键菜单容器
(function initSchemeMenu() {
  if (document.getElementById('scheme-ctx-menu')) return;
  const m = document.createElement('div');
  m.id = 'scheme-ctx-menu';
  m.className = 'ctx-menu hidden';
  document.body.appendChild(m);
})();

initSchemesDrag();
