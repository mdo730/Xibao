// ---- 快速访问（localStorage 持久化） ----
const QUICK_KEY = 'xibao_quick_access';
function loadQuickAccess() {
  try { return JSON.parse(localStorage.getItem(QUICK_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveQuickAccess(list) {
  try { localStorage.setItem(QUICK_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
}
function renderQuickAccess() {
  const listEl = document.getElementById('quick-list');
  if (!listEl) return;
  const list = loadQuickAccess();
  listEl.innerHTML = '';
  if (!list.length) {
    listEl.innerHTML = '<div class="quick-empty">右键文件夹 → 添加到快速访问</div>';
    return;
  }
  for (const it of list) {
    const div = document.createElement('div');
    div.className = 'quick-item';
    div.title = it.path;
    div.innerHTML = `<span class="quick-icon">📁</span><span class="quick-name">${it.name}</span>`;
    div.onclick = () => openFolder(it.path);
    div.oncontextmenu = e => {
      e.preventDefault(); e.stopPropagation();
      quickCtxItem = it;
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      const menu = document.getElementById('tag-ctx-menu');
      menu.innerHTML = '<div onclick="quickRemove()">从快速访问移除</div>';
      menu.classList.remove('hidden');
      menu.style.left = Math.min(e.clientX, window.innerWidth - 140) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 130) + 'px';
    };
    listEl.appendChild(div);
  }
}
let quickCtxItem = null;
function addToQuickAccess(path) {
  const list = loadQuickAccess();
  const norm = path.replace(/\/+$/, '');
  if (list.some(x => x.path === norm)) return;
  list.unshift({path: norm, name: norm.split('/').filter(Boolean).pop() || norm});
  saveQuickAccess(list);
  renderQuickAccess();
}
function quickRemove() {
  if (!quickCtxItem) return;
  saveQuickAccess(loadQuickAccess().filter(x => x.path !== quickCtxItem.path));
  renderQuickAccess();
}
renderQuickAccess();

// 拖到文件树目录 → 移动（带确认，防误操作）
async function handleDropOnTree(e, destPath) {
  const payload = e.dataTransfer.getData('text/plain');
  let items;
  try { items = JSON.parse(payload); } catch { return; }
  if (!items || !items.length) return;
  const srcs = items.map(i => i.path);
  if (!confirm(`将 ${srcs.length} 项移动到「${destPath}」？`)) return;
  let failed = 0;
  for (const s of srcs) {
    try {
      const r = await fetch('/api/file/move', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({src: s, dest_dir: destPath})});
      const d = await r.json();
      if (!d.ok) { failed++; console.warn('move failed', s, d.error); }
    } catch (err) { failed++; }
  }
  if (failed) alert(`${failed} 项移动失败（可能已存在同名）`);
  refresh(); loadFileTree();
}

// ---- 文件树（惰性加载）----
async function loadFileTree() {
  const r = await fetch('/api/filetree');
  const d = await r.json();
  if (!d.ok) return;
  fileTreeEl.innerHTML = '';
  for (const node of d.tree) await renderTreeItem(node, 0);
}

async function renderTreeItem(node, depth, parentEl) {
  const container = parentEl || fileTreeEl;
  const div = document.createElement('div');
  div.className = 'tree-item';
  div.dataset.path = node.path;
  div.dataset.expanded = '0';
  div.dataset.loaded = '0';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'tree-arrow';
  arrowSpan.textContent = '▶';
  div.appendChild(arrowSpan);
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = node.name;
  div.appendChild(label);
  div.style.paddingLeft = (depth * 14 + 8) + 'px';

  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'tree-children';
  const childrenInner = document.createElement('div');
  childrenInner.className = 'tree-children-inner';
  childrenWrap.appendChild(childrenInner);
  div.dataset.childrenWrap = '';

  div.onclick = e => {
    e.stopPropagation();
    openFolder(node.path);
  };
  // 拖拽反馈：拖到目录上高亮
  div.ondragover = e => { e.preventDefault(); div.classList.add('drop-target'); };
  div.ondragleave = () => div.classList.remove('drop-target');
  div.ondrop = e => {
    e.preventDefault();
    div.classList.remove('drop-target');
    handleDropOnTree(e, node.path);
  };
  arrowSpan.onclick = async e => {
    e.stopPropagation();
    if (div.dataset.expanded === '1') collapseTreeItem(div);
    else await expandTreeItem(div, depth + 1);
  };
  container.appendChild(div);
  container.appendChild(childrenWrap);
}

// 展开树节点（首次加载子级）
async function expandTreeItem(div, childDepth) {
  if (!div || div.dataset.expanded === '1') return;
  if (div.dataset.loading === '1') return;
  const path = div.dataset.path;
  const childrenWrap = div.nextElementSibling;
  if (!childrenWrap) return;
  div.dataset.loading = '1';
  try {
    if (div.dataset.loaded !== '1') {
      const ch = await fetch('/api/filetree/children?path=' + encodeURIComponent(path));
      const cd = await ch.json();
      const inner = childrenWrap.querySelector('.tree-children-inner') || childrenWrap;
      inner.innerHTML = '';
      for (const k of cd.children || []) await renderTreeItem(k, (childDepth || 0), inner);
      div.dataset.loaded = '1';
    }
    childrenWrap.classList.add('open');
    div.querySelector('.tree-arrow').textContent = '▼';
    div.dataset.expanded = '1';
  } finally {
    delete div.dataset.loading;
  }
}

function collapseTreeItem(div) {
  if (!div) return;
  const childrenWrap = div.nextElementSibling;
  if (childrenWrap) childrenWrap.classList.remove('open');
  div.querySelector('.tree-arrow').textContent = '▶';
  div.dataset.expanded = '0';
}

// 让文件树展开到指定路径并高亮（从盘符根逐层展开）
async function expandToPath(path) {
  if (!path) return;
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  // 从最外层盘符（C:）开始
  const rootPrefix = parts[0]; // 如 "C:"
  const roots = Array.from(fileTreeEl.children);
  let current = roots.find(el => {
    const p = (el.dataset.path || '').replace(/\\/g, '/');
    return p === rootPrefix || p === rootPrefix + '/' || p === rootPrefix + '\\';
  });
  if (!current) return;
  // 逐层展开并找下一级
  let depth = 0;
  let pathSoFar = rootPrefix;
  let node = current;
  while (node && depth < parts.length - 1) {
    await expandTreeItem(node, depth + 1);
    // 找子节点中匹配下一段的
    const childrenWrap = node.nextElementSibling;
    const target = parts[depth + 1];
    let next = null;
    if (childrenWrap) {
      for (const child of childrenWrap.querySelectorAll(':scope > .tree-item')) {
        const cp = (child.dataset.path || '').replace(/\\/g, '/').toLowerCase();
        const ct = (pathSoFar + '/' + target).toLowerCase();
        if (cp === ct || cp === ct + '/' || cp.startsWith(ct + '/')) { next = child; break; }
      }
    }
    if (!next) break;
    pathSoFar += '/' + target;
    node = next;
    depth++;
  }
  // 高亮最后到达的节点
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active'));
  if (node) node.classList.add('active');
}

// ---- 标签树 ----
async function loadTags() {
  const r = await fetch('/api/tags');
  const d = await r.json();
  allTags = d.tags || [];
  renderTagTree();
}

let selColor = '#ecc889';
const PALETTE = [
  '#ecc889', '#f0c6c6', '#f5d9a8', '#d9f0c6', '#c6e8f0',
  '#d9c6f0', '#f0e0c6', '#c6f0d9', '#f0c6e0', '#c6c6f0',
  '#f5f5dc', '#ffd700', '#ff8c00', '#ff6347', '#32cd32',
  '#00bfff', '#9370db', '#ff69b4', '#a9a9a9', '#000000',
];
function openTagColor() {
  if (!tagCtxItem) return;
  selColor = tagCtxItem.color || '#ecc889';
  document.getElementById('tag-color-title').textContent = '设置「' + tagName(tagCtxItem.id) + '」颜色';
  const palette = document.getElementById('tag-color-palette');
  palette.innerHTML = '';
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === selColor ? ' sel' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.onclick = () => {
      selColor = c;
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('sel'));
      sw.classList.add('sel');
      updateColorPreview();
    };
    palette.appendChild(sw);
  });
  updateColorPreview();
  modalShow(document.getElementById('tag-color-modal'));
}
function updateColorPreview() {
  const p = document.getElementById('tag-color-preview');
  p.style.background = selColor;
  p.textContent = selColor;
}
async function saveTagColor() {
  if (typeof schemeColorTarget !== 'undefined' && schemeColorTarget >= 0) {
    if (typeof loadSchemes === 'function') {
      const list = loadSchemes();
      if (list[schemeColorTarget]) {
        list[schemeColorTarget].color = selColor;
        saveSchemes(list);
      }
    }
    schemeColorTarget = -1;
    closeTagColor();
    if (typeof renderSchemes === 'function') renderSchemes();
    return;
  }
  const r = await fetch('/api/tags/' + tagCtxItem.id + '/color', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({color: selColor}),
  });
  const d = await r.json();
  if (!d.ok) alert('设置颜色失败: ' + (d.error || ''));
  closeTagColor();
  loadTags();
}
function closeTagColor() {
  modalHide(document.getElementById('tag-color-modal'));
}

function tagDelete() {
  if (!tagCtxItem) return;
  if (!confirm(`删除标签「${tagName(tagCtxItem.id)}」及其子标签？`)) return;
  fetch('/api/tags/' + tagCtxItem.id, {method: 'DELETE'}).then(() => {
    // 若删除的标签在当前筛选集合中，先清筛选
    if (currentTagIds.includes(tagCtxItem.id)) {
      currentTagIds = currentTagIds.filter(x => x !== tagCtxItem.id);
      renderFilterChips();
    }
    loadTags(); refresh();   // 无论是否筛选都刷新标签树
  });
}
async function apiAddTag(name, parentId) {
  const r = await fetch('/api/tags', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, parent_id: parentId})});
  const d = await r.json();
  if (!d.ok) { alert('创建失败: ' + (d.error || '')); return; }
  loadTags();
}

