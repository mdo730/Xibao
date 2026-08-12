// ---- 快速访问（localStorage 持久化，渲染进文件树） ----
const QUICK_KEY = 'xibao_quick_access';
function loadQuickAccess() {
  try { return JSON.parse(localStorage.getItem(QUICK_KEY) || '[]'); }
  catch (e) { return []; }
}
function saveQuickAccess(list) {
  try { localStorage.setItem(QUICK_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
}
let quickCtxItem = null;
function addToQuickAccess(path) {
  const list = loadQuickAccess();
  const norm = path.replace(/\/+$/, '');
  if (list.some(x => x.path === norm)) return;
  list.unshift({path: norm, name: norm.split('/').filter(Boolean).pop() || norm});
  saveQuickAccess(list);
  loadFileTree();
}
function quickRemove() {
  if (!quickCtxItem) return;
  saveQuickAccess(loadQuickAccess().filter(x => x.path !== quickCtxItem.path));
  loadFileTree();
}

// ---- 文件树宽度可拖拽（存 localStorage） ----
const FTREE_WIDTH_KEY = 'xibao_filetree_width';
function restoreFileTreeWidth() {
  const panel = document.getElementById('filetree-panel');
  if (!panel) return;
  const saved = parseInt(localStorage.getItem(FTREE_WIDTH_KEY) || '0', 10);
  if (saved >= 140) panel.style.width = saved + 'px';
}
function initFileTreeResizer() {
  const resizer = document.getElementById('filetree-resizer');
  const panel = document.getElementById('filetree-panel');
  if (!resizer || !panel) return;
  restoreFileTreeWidth();
  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.offsetWidth;
    function move(ev) {
      let w = startW + (ev.clientX - startX);
      w = Math.max(140, Math.min(w, 500));
      panel.style.width = w + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      localStorage.setItem(FTREE_WIDTH_KEY, panel.offsetWidth);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
initFileTreeResizer();

// ---- 标签树宽度可拖拽（存 localStorage） ----
const TAG_WIDTH_KEY = 'xibao_tag_width';
function restoreTagWidth() {
  const panel = document.getElementById('tag-panel');
  if (!panel) return;
  const saved = parseInt(localStorage.getItem(TAG_WIDTH_KEY) || '0', 10);
  if (saved >= 180 && !panel.classList.contains('floating')) panel.style.width = saved + 'px';
}
function initTagResizer() {
  const resizer = document.getElementById('tag-resizer');
  const panel = document.getElementById('tag-panel');
  if (!resizer || !panel) return;
  restoreTagWidth();
  resizer.addEventListener('mousedown', e => {
    if (panel.classList.contains('floating')) return;  // 浮动模式不拖拽
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.offsetWidth;
    function move(ev) {
      // 向右拖 = 变窄（标签树在右侧）
      let w = startW - (ev.clientX - startX);
      w = Math.max(180, Math.min(w, 420));
      panel.style.width = w + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      localStorage.setItem(TAG_WIDTH_KEY, panel.offsetWidth);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });
}
initTagResizer();

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

// ---- 文件树（惰性加载；Known Folders 按设置过滤 + 快速访问 + 分隔线 + 盘符）----
// 展开状态记忆：重建后恢复手动展开的目录（避免操作后整树坍缩）
function collectExpandedPaths() {
  const out = [];
  document.querySelectorAll('#filetree .tree-item[data-expanded="1"]').forEach(el => {
    const p = el.dataset.path;
    if (p) out.push(p);
  });
  return out;
}
async function loadFileTree(restoreExpanded) {
  const prevExpanded = (restoreExpanded !== false)
    ? collectExpandedPaths()
    : (typeof currentPath === 'string' ? [currentPath] : []);
  const r = await fetch('/api/filetree');
  const d = await r.json();
  if (!d.ok) return;
  fileTreeEl.innerHTML = '';
  const setting = (typeof knownFoldersSetting === 'function') ? knownFoldersSetting() : {on: true, list: []};
  const knownNodes = d.tree.filter(n => n.is_known);
  const driveNodes = d.tree.filter(n => !n.is_known);
  // 系统文件夹（按设置过滤）
  if (setting.on) {
    const shown = setting.list && setting.list.length
      ? knownNodes.filter(n => setting.list.includes(n.name))
      : knownNodes;
    for (const node of shown) await renderTreeItem(node, 0);
  }
  // 快速访问（在系统文件夹下方）
  const quick = loadQuickAccess();
  if (quick.length) {
    for (const it of quick) await renderQuickTreeItem(it, 0);
  }
  // 有上方内容则加分隔线
  const hasTop = (setting.on && (setting.list && setting.list.length
      ? knownNodes.some(n => setting.list.includes(n.name)) : knownNodes.length)) || quick.length;
  if (hasTop) {
    const sep = document.createElement('div');
    sep.className = 'tree-sep';
    fileTreeEl.appendChild(sep);
  }
  // 盘符
  for (const node of driveNodes) await renderTreeItem(node, 0);
  // 恢复此前展开的路径（expandToPath 从盘符根逐层展开，惰性 children 按需重载）
  const seen = new Set();
  for (const p of prevExpanded) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    try { await expandToPath(p); } catch (e) { /* 单条失败继续 */ }
  }
}

// 快速访问条目渲染为树节点（可点击进入，右键移除）
async function renderQuickTreeItem(it, depth) {
  const div = document.createElement('div');
  div.className = 'tree-item quick-tree-item';
  div.dataset.path = it.path;
  div.dataset.expanded = '0';
  div.dataset.loaded = '0';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'tree-arrow';
  arrowSpan.textContent = '▶';
  div.appendChild(arrowSpan);
  const label = document.createElement('span');
  label.className = 'tree-label';
  label.textContent = '⭐ ' + it.name;
  div.appendChild(label);
  div.style.paddingLeft = '8px';
  div.title = it.path;

  const childrenWrap = document.createElement('div');
  childrenWrap.className = 'tree-children';
  const childrenInner = document.createElement('div');
  childrenInner.className = 'tree-children-inner';
  childrenWrap.appendChild(childrenInner);
  div.dataset.childrenWrap = '';

  div.onclick = e => {
    e.stopPropagation();
    openFolder(it.path);
  };
  div.ondragover = e => { e.preventDefault(); div.classList.add('drop-target'); };
  div.ondragleave = () => div.classList.remove('drop-target');
  div.ondrop = e => {
    e.preventDefault();
    div.classList.remove('drop-target');
    handleDropOnTree(e, it.path);
  };
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
  arrowSpan.onclick = async e => {
    e.stopPropagation();
    if (div.dataset.expanded === '1') collapseTreeItem(div);
    else await expandTreeItem(div, depth + 1);
  };
  fileTreeEl.appendChild(div);
  fileTreeEl.appendChild(childrenWrap);
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
  label.textContent = node.display || node.name;
  div.appendChild(label);
  div.style.paddingLeft = (Math.min(depth, 8) * 14 + 8) + 'px';

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


