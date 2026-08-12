// ---- 右键菜单（自 explorer-core.js 拆分）----
// 依赖全局：ctxItem/selected/selKeys/currentCtx/_allItems（core）、loadTags（tags-jstree）、openFile（core）
// 加载顺序：必须在 explorer-core.js 之后、explorer-tags.js 之前

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
  if (kind === 'folder') {
    // 已在快速访问 → 显示移除，否则添加
    const inQuick = (typeof loadQuickAccess === 'function') &&
      loadQuickAccess().some(x => x.path === path.replace(/\/+$/, ''));
    html += inQuick
      ? '<div onclick="ctxRemoveQuick()">⭐ 从快速访问移除</div>'
      : '<div onclick="ctxAddQuick()">⭐ 添加到快速访问</div>';
  }
  if (kind === 'folder') html += '<div onclick="ctxCopyTagTree()">📋 复制标签树</div>';
  if (kind === 'folder') html += '<div onclick="ctxFlattenFolder()">🔍 平铺文件夹</div>';
  if (kind === 'file') html += '<div onclick="ctxOpen()">打开</div>';
  html += '<div onclick="ctxOpenFolder()">打开所在文件夹</div>';
  if (!isMulti) html += '<div onclick="ctxSetAlias()">设置备注名 <span class="ctx-key">R</span></div>';
  html += '<div onclick="ctxCopyPath()">复制路径</div>';
  html += '<div onclick="ctxRename()">重命名 <span class="ctx-key">F2</span></div>';
  html += '<div onclick="ctxDelete()">删除</div>';
  html += '<div onclick="ctxAttr()">属性 <span class="ctx-key">F</span></div>';
  html += '<div class="ctx-sep"></div><div class="ctx-tools-loading muted" style="padding:6px 12px;font-size:12px;color:#999">外部工具…</div>';
  menu.innerHTML = html;
  menu.classList.remove('hidden');
  positionCtxMenu(menu, e.clientX, e.clientY);
  // 异步加载外部工具动作（仅单选/目标为文件或文件夹时）
  if (selected.size <= 1) loadCtxTools(path, kind);
}
// 右键菜单定位：避免超出视口（尤其靠近底部/右侧时上移/左移）
function positionCtxMenu(menu, x, y) {
  const margin = 8;
  // 用 visibility 隐藏测量真实尺寸，避免 0,0 闪烁
  const prevVis = menu.style.visibility;
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = x;
  let top = y;
  if (left + w + margin > window.innerWidth) left = window.innerWidth - w - margin;
  if (top + h + margin > window.innerHeight) top = window.innerHeight - h - margin;
  left = Math.max(margin, left);
  top = Math.max(margin, top);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.visibility = prevVis || 'visible';
}
// 加载外部工具动作到右键菜单（kind: file/folder——文件夹不显示解压类工具）
async function loadCtxTools(path, kind) {
  const menu = document.getElementById('ctx-menu');
  const loading = menu.querySelector('.ctx-tools-loading');
  try {
    const r = await fetch('/api/tools');
    const d = await r.json();
    let tools = (d.tools || []).filter(t => t.key !== 'everything-search-here');
    // 文件夹不能"解压"：过滤掉解压类动作
    if (kind === 'folder') tools = tools.filter(t => t.key.indexOf('extract') === -1);
    if (loading) loading.remove();
    if (!tools.length) {
      // 无工具：移除分隔线，菜单干净
      const sep = menu.querySelector('.ctx-sep');
      if (sep) sep.remove();
      // 高度变化后重新定位
      const rect = menu.getBoundingClientRect();
      positionCtxMenu(menu, rect.left, rect.top);
      return;
    }
    const wrap = menu.querySelector('.ctx-sep');
    if (!wrap) return;
    tools.forEach(t => {
      const div = document.createElement('div');
      div.textContent = t.label;
      div.onclick = () => ctxRunTool(t.key, path);
      menu.insertBefore(div, null);
    });
    // 工具加载后菜单变高，重新定位避免超界
    const rect = menu.getBoundingClientRect();
    positionCtxMenu(menu, rect.left, rect.top);
  } catch (e) { if (loading) loading.remove(); }
}
async function ctxRunTool(key, path) {
  hideContextMenus();
  try {
    const r = await fetch('/api/tools/run', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key, path})});
    const d = await r.json();
    if (d.done) refresh();  // 解压类完成，刷新文件列表
  } catch (e) { /* 忽略 */ }
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
// 当前操作目标：优先当前选中项（键盘/通用），右键菜单场景由调用方显式传 ctxItem
function currentCtx() {
  if (selected.size) {
    const k = selKeys()[0];
    const it = _allItems.find(x => x.path === k);
    return {path: k, kind: it && it.isFolder ? 'folder' : 'file'};
  }
  if (ctxItem) return ctxItem;
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
// 复制标签树：把文件夹目录结构转成标签树（v0.6.1）
function ctxCopyTagTree() {
  hideContextMenus();
  if (!ctxItem || ctxItem.kind !== 'folder') return;
  copyTagTreePath = ctxItem.path;
  const modal = document.getElementById('copy-tagtree-modal');
  modal.classList.remove('hidden');
  // 渲染挂载点标签树（jsTree，单选）
  const container = document.getElementById('copy-tagtree-tree');
  if ($) {
    const data = [{id: 'tag_0', text: '📁 根级（不挂到任何标签下）', children: buildCopyTree(0)}];
    if (!$(container).data('jstree')) {
      $(container).jstree({
        core: {data, multiple: false, themes: {name: 'default', dots: true, icons: false}},
        plugins: [],
      }).on('ready.jstree', function () {
        try { $(container).jstree(true).open_all(); } catch (e) {}
      });
    } else {
      const t = $(container).jstree(true);
      t.settings.core.data = data;
      t.refresh();
      try { t.open_all(); } catch (e) {}
    }
  }
  // 打标开关默认开
  document.getElementById('copy-tagtree-apply').checked = true;
  document.getElementById('copy-tagtree-status').textContent = '';
}
function buildCopyTree(parentId) {
  return tagChildren(parentId).map(t => ({
    id: 'tag_' + t.id,
    text: t.name,
    children: tagChildren(t.id).length ? buildCopyTree(t.id) : [],
  }));
}
let copyTagTreePath = null;
async function confirmCopyTagTree() {
  const status = document.getElementById('copy-tagtree-status');
  const applyTags = document.getElementById('copy-tagtree-apply').checked;
  // 挂载点：选中的标签 id（未选=根级）
  let parentId = 0;
  if ($ && $('#copy-tagtree-tree').data('jstree')) {
    const t = $('#copy-tagtree-tree').jstree(true);
    const sel = t.get_selected();
    if (sel && sel.length) {
      const pid = parseInt(String(sel[0]).replace('tag_', ''));
      parentId = isNaN(pid) ? 0 : pid;
    }
  }
  status.textContent = '⏳ 正在生成标签树…';
  try {
    const r = await fetch('/api/tags/from-folder', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({path: copyTagTreePath, parent_tag_id: parentId, apply_tags: applyTags}),
    });
    const d = await r.json();
    if (!d.ok) { status.textContent = '❌ ' + (d.error || '生成失败'); return; }
    status.textContent = `✅ 生成 ${d.tags_created} 个新标签（复用 ${d.tags_merged}）`;
    document.getElementById('copy-tagtree-close-btn').click();
    loadTags(); refresh();
  } catch (e) { status.textContent = '❌ ' + e.message; }
}
function closeCopyTagTree() {
  document.getElementById('copy-tagtree-modal').classList.add('hidden');
}
function ctxCopyPath() {
  hideContextMenus();
  const c = currentCtx();
  if (!c) return;
  const text = c.path.replace(/\//g, '\\');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => prompt('复制失败，请手动复制：', text));
  } else {
    prompt('复制路径：', text);
  }
}
function ctxOpen() {
  hideContextMenus(); if (ctxItem && ctxItem.kind === 'file') openFile(ctxItem.path); }
function ctxAddQuick() {
  hideContextMenus();
  if (!ctxItem || ctxItem.kind !== 'folder') return;
  if (typeof addToQuickAccess === 'function') addToQuickAccess(ctxItem.path);
}
function ctxRemoveQuick() {
  hideContextMenus();
  if (!ctxItem || ctxItem.kind !== 'folder') return;
  // 直接操作 localStorage 移除（和 addToQuickAccess 存的原样路径比对）
  if (typeof loadQuickAccess === 'function' && typeof saveQuickAccess === 'function') {
    const norm = ctxItem.path.replace(/\/+$/, '');
    const list = loadQuickAccess().filter(x => x.path !== norm);
    saveQuickAccess(list);
    if (typeof loadFileTree === 'function') loadFileTree();
  }
}
async function ctxRename() {
  hideContextMenus();
  if (!ctxItem) return;
  // Windows 路径可能用反斜杠，split 同时兼容 / 和 \
  const name = prompt('新名称：', ctxItem.path.split(/[\\/]/).pop());
  if (!name || !name.trim()) return;
  const r = await fetch('/api/file/rename', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({key: ctxItem.path, new_name: name.trim()})});
  const d = await r.json();
  if (!d.ok) { alert('重命名失败: ' + (d.error || '')); return; }
  refresh(); loadFileTree();
}