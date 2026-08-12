// ---- 文件操作/属性/删除（自 explorer-core.js 拆分）----
// 依赖全局：selected/data/currentPath（core）、encPath（core）、loadTags（tags-jstree）、refresh（core）
// 加载顺序：必须在 explorer-core.js 之后

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

