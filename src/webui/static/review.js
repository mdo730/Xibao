// ---- 统一任务视图（v0.6.0 第 8 步）----
// 两种模式共用同一套缩略图卡片视图，仅操作按钮不同：
//   reviewMode（待审核）: 接受 / 拒绝
//   orphanMode（标签异常）: 修改标签 / 移除标签
let taskViewMode = null;   // 'review' | 'orphan' | null
let pendingGroups = [];
let taskViewSeq = 0;       // 切换序号：防止异步 refresh 覆盖新视图
// 异常模式分页（9252+ 文件不卡顿）
let orphanPage = 0;
const orphanLimit = 100;
let orphanTotal = 0;

// ---------- 角标（按钮仅在有内容时显示） ----------

async function refreshPendingBadge() {
  try {
    const r = await fetch('/api/v1/tags/pending');
    const d = await r.json();
    if (!d.ok) return;
    const btn = document.getElementById('btn-pending-review');
    const badge = document.getElementById('pending-badge');
    if (btn) btn.style.display = d.count ? '' : 'none';
    if (badge) {
      badge.textContent = d.count || 0;
      badge.classList.toggle('hidden', !d.count);
    }
  } catch (e) { /* 忽略 */ }
}

async function refreshOrphanBadge() {
  try {
    const r = await fetch('/api/tags/orphans');
    const d = await r.json();
    if (!d.ok) return;
    const btn = document.getElementById('btn-tag-orphans');
    const badge = document.getElementById('orphan-badge');
    if (btn) btn.style.display = d.count ? '' : 'none';
    if (badge) {
      badge.textContent = d.count || 0;
      badge.classList.toggle('hidden', !d.count);
    }
  } catch (e) { /* 忽略 */ }
}

// ---------- 模式切换 ----------

function toggleTaskView(mode) {
  if (taskViewMode === mode) {
    exitTaskView();
    return;
  }
  if (taskViewMode) exitTaskView();
  taskViewMode = mode;
  taskViewSeq++;
  const seq = taskViewSeq;
  if (mode === 'review') enterReviewView(seq);
  else enterOrphanView(seq);
}

function toggleReviewMode() { toggleTaskView('review'); }
function toggleOrphanMode() { toggleTaskView('orphan'); }

function exitTaskView() {
  taskViewMode = null;
  taskViewSeq++;
  selected.clear();
  ['btn-pending-review', 'btn-tag-orphans'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.remove('active');
  });
  const banner = document.getElementById('review-banner');
  if (banner) banner.remove();
  const bar = document.getElementById('orphan-action-bar');
  if (bar) bar.remove();
  const pager = document.getElementById('orphan-pager');
  if (pager) pager.remove();
  orphanPage = 0; orphanTotal = 0;
  if (typeof refresh === 'function') refresh();
}

async function enterReviewView(seq) {
  const r = await fetch('/api/v1/tags/pending');
  const d = await r.json();
  if (seq !== undefined && seq !== taskViewSeq) return;
  if (!d.ok) { alert('加载待审核失败: ' + (d.error || '')); taskViewMode = null; return; }
  pendingGroups = d.items || [];
  selected.clear();   // 进入任务视图清空旧选择
  const btn = document.getElementById('btn-pending-review');
  if (btn) btn.classList.add('active');
  renderTaskBanner();
  renderTaskGrid();
}

function _orphanToGroups(items) {
  return (items || []).map(it => ({
    path: it.path,
    type: _guessType(it.path),
    isFolder: !!it.is_folder,
    ids: [it.tag_id],
    tags: [{name: it.tag, parent: null, source: '父级标签'}],
  }));
}

async function enterOrphanView(seq) {
  const r = await fetch(`/api/tags/orphans?offset=${orphanPage * orphanLimit}&limit=${orphanLimit}`);
  const d = await r.json();
  if (seq !== undefined && seq !== taskViewSeq) return;
  if (!d.ok) { alert('加载标签异常失败: ' + (d.error || '')); taskViewMode = null; return; }
  orphanTotal = d.total || d.count || 0;
  pendingGroups = _orphanToGroups(d.items);
  selected.clear();   // 进入任务视图清空旧选择，避免计数残留
  updateOrphanOrderedKeys();
  const btn = document.getElementById('btn-tag-orphans');
  if (btn) btn.classList.add('active');
  renderTaskBanner();
  renderTaskGrid();
  renderOrphanPager();
  refreshOrphanBadge();
}

// 异常模式：填充 orderedKeys + _allItems（主界面键盘导航/Shift 范围依赖它们）
function updateOrphanOrderedKeys() {
  if (typeof orderedKeys !== 'undefined') {
    orderedKeys = pendingGroups.map(g => g.path);
  }
  if (typeof _allItems !== 'undefined') {
    _allItems = pendingGroups.map(g => ({path: g.path, isFolder: false}));
  }
}

function _guessType(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  const img = ['png','jpg','jpeg','gif','bmp','webp','psd','tif','tiff','ico','svg'];
  const vid = ['mp4','mkv','avi','mov','wmv','flv','webm','m4v'];
  if (img.includes(ext)) return 'image';
  if (vid.includes(ext)) return 'video';
  return 'other';
}

// ---------- 顶部条 ----------

function renderTaskBanner() {
  let banner = document.getElementById('review-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'review-banner';
    banner.className = 'review-banner';
    const body = document.getElementById('explorer-body');
    body.insertBefore(banner, body.firstChild);
  }
  const isReview = taskViewMode === 'review';
  const title = isReview ? '🕓 待审核' : '⚠️ 标签异常';
  const countText = pendingGroups.length + ' 个文件';
  const allBtn = isReview
    ? `<button class="mini ok" onclick="reviewAll(true)">✅ 全部接受</button>
       <button class="mini danger" onclick="reviewAll(false)">🗑 全部拒绝</button>`
    : '';   // 异常模式操作在底部栏，顶部只留标题+数量
  banner.innerHTML = `<span class="review-banner-title">${title}</span>
    <span class="muted" id="review-banner-count">${countText}</span>
    <span class="review-banner-actions">${allBtn}</span>`;
}

// ---------- 卡片视图（两种模式共用） ----------

function renderTaskGrid() {
  const grid = document.getElementById('item-grid');
  if (!grid) return;
  grid.className = 'grid-view';
  grid.innerHTML = '';
  if (!pendingGroups.length) {
    const emptyText = taskViewMode === 'review' ? '没有待审核的写入 🎉' : '没有标签异常 🎉';
    grid.innerHTML = `<div class="review-empty"><div>${emptyText}</div><button class="mini" style="margin-top:12px" onclick="exitTaskView()">退出</button></div>`;
    return;
  }
  const isReview = taskViewMode === 'review';
  let idx = 0;
  for (const g of pendingGroups) {
    const card = document.createElement('div');
    const sel = !isReview && selected.has(g.path);
    card.className = 'cell cell-file review-card' + (sel ? ' sel' : '');
    card.dataset.path = g.path;
    card.dataset.key = g.path;   // 复用主界面多选（selected/onItemClick/框选）
    let display = '';
    if (g.isFolder) {
      display = `<div class="cell-icon">📁</div>`;
    } else if (g.type === 'image') {
      display = `<img class="cell-thumb" src="${relUrl(g.path)}" loading="lazy">`;
    } else if (g.type === 'video') {
      display = `<img class="cell-thumb video-thumb" src="/api/thumb?path=${encodeURIComponent(g.path)}&size=256" loading="lazy">`;
    } else {
      display = fileIconHtml(basename(g.path), 'cell-icon-img', 'cell-icon', iconOf('other'), g.path);
    }
    const srcs = [...new Set(g.tags.map(t => t.source || 'external'))].join(',');
    const actions = isReview
      ? `<button class="mini ok" onclick="reviewGroup('${escAttr(g.path)}', true)">✅ 接受</button>
         <button class="mini danger" onclick="reviewGroup('${escAttr(g.path)}', false)">🗑 拒绝</button>`
      : `<div class="review-card-actions-icons">
           <button class="icon-btn" onclick="event.stopPropagation();openTagModal('${escAttr(g.path)}', 'file', 'set', ${JSON.stringify(g.ids || [])})" title="修改标签" aria-label="修改标签">✏️</button>
           <button class="icon-btn danger" onclick="event.stopPropagation();removeOrphan('${escAttr(g.path)}')" title="移除异常标签" aria-label="移除异常标签">🗑</button>
         </div>`;
    // 异常模式：异常标签单独标红一行（一个文件最多一个异常标签）
    const abnormalHtml = isReview ? '' :
      `<div class="review-card-abnormal"><span class="review-tag-warn">⚠️ ${escHtml(g.tags[0] ? g.tags[0].name : '')}</span></div>`;
    card.innerHTML = `
      <div class="cell-content">${display}</div>
      <div class="cell-name">${escHtml(basename(g.path))}</div>
      ${abnormalHtml}
      <div class="review-card-meta muted">${isReview ? '来源: ' + escHtml(srcs) : '此标签现在是父级，编辑弹窗不可勾选'}</div>
      <div class="review-card-actions">${actions}</div>`;
    // 异常模式：复用主界面多选（单击/Ctrl/Shift）
    if (!isReview) {
      const cardIdx = idx;
      card.addEventListener('click', e => {
        if (typeof onItemClick === 'function') onItemClick(e, cardIdx, g.path, false);
        renderOrphanActionBar();
      });
      card.addEventListener('dblclick', e => { e.stopPropagation(); });
    }
    if (g.type !== 'image') {
      const vt = card.querySelector('.video-thumb, .doc-thumb');
      if (vt) {
        vt.onerror = () => {
          const fallback = fileIconHtml(basename(g.path), 'cell-icon-img', 'cell-icon', iconOf('other'), g.path);
          const cc = card.querySelector('.cell-content');
          if (cc) cc.innerHTML = fallback;
        };
      }
    }
    grid.appendChild(card);
    idx++;
  }
  if (!isReview) {
    grid.style.paddingBottom = '70px';  // 避免被 fixed 底部栏遮挡
    renderOrphanActionBar();
  }
}

function basename(p) {
  return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

function escAttr(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// ---------- 异常模式底部操作栏 ----------

function renderOrphanActionBar() {
  let bar = document.getElementById('orphan-action-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'orphan-action-bar';
    bar.className = 'orphan-action-bar';
    document.body.appendChild(bar);
  }
  // fixed 定位：只占文件列表区域宽度（文件树右缘 → 标签树左缘）
  const ft = document.getElementById('filetree-panel');
  const tp = document.getElementById('tag-panel');
  let left = 0, right = 0;
  if (ft) left = ft.getBoundingClientRect().right;
  if (tp) right = window.innerWidth - tp.getBoundingClientRect().left;
  bar.style.left = left + 'px';
  bar.style.right = right + 'px';
  const total = pendingGroups.length;
  const sel = selected.size;
  bar.innerHTML = `<span class="orphan-bar-count">已选 <strong>${sel}</strong> 项 / 本页 ${total}</span>
    <span class="orphan-bar-actions">
      <button class="action-btn" onclick="orphanSelectPage()">☑ 全选本页</button>
      <button class="action-btn ok" onclick="orphanRemoveThenAdd()">🟢 移除并添加标签</button>
      <button class="action-btn danger" onclick="orphanRemoveSelected()">🗑 移除异常标签</button>
      <button class="action-btn" onclick="exitTaskView()">✕ 退出</button>
    </span>`;
}

// 异常分页条
function renderOrphanPager() {
  let pager = document.getElementById('orphan-pager');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'orphan-pager';
    pager.className = 'flatten-pager';
    document.getElementById('explorer-body').appendChild(pager);
  }
  const totalPages = Math.max(1, Math.ceil(orphanTotal / orphanLimit));
  const cur = orphanPage + 1;
  pager.innerHTML = `<span class="muted">共 ${orphanTotal} 个异常 · 第 ${cur}/${totalPages} 页</span>
    <button class="mini" ${cur <= 1 ? 'disabled' : ''} onclick="orphanPageMove(-1)">← 上一页</button>
    <button class="mini" ${cur >= totalPages ? 'disabled' : ''} onclick="orphanPageMove(1)">下一页 →</button>`;
}

function orphanPageMove(delta) {
  const next = orphanPage + delta;
  if (next < 0 || next * orphanLimit >= orphanTotal) return;
  orphanPage = next;
  selected.clear();
  refreshReviewView();
  const body = document.getElementById('explorer-body');
  if (body) body.scrollTop = 0;
}

// 全选本页
function orphanSelectPage() {
  if (!pendingGroups.length) return;
  // 切换：若本页已全选则清空，否则全选本页
  const pageAll = pendingGroups.every(g => selected.has(g.path));
  if (pageAll) {
    pendingGroups.forEach(g => selected.delete(g.path));
  } else {
    pendingGroups.forEach(g => selected.add(g.path));
  }
  renderTaskGrid();
}

function orphanRemoveSelected() {
  if (!selected.size) { alert('请先选择文件'); return; }
  if (!confirm(`移除 ${selected.size} 个文件上的异常标签？`)) return;
  const paths = Array.from(selected);
  doOrphanRemove(paths);
}

async function doOrphanRemove(paths) {
  try {
    const r = await fetch('/api/tags/orphans/clear-path', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({paths})});
    const d = await r.json();
    if (!d.ok) { alert('操作失败: ' + (d.error || '')); return; }
    selected.clear();
    refreshReviewView();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

// 移除并添加标签：先移除异常标签，再打开多选编辑弹窗批量追加新标签
async function orphanRemoveThenAdd() {
  if (!selected.size) { alert('请先选择文件'); return; }
  if (!confirm(`移除 ${selected.size} 个文件上的异常标签，并打开标签编辑？`)) return;
  const paths = Array.from(selected);
  try {
    // 先移除异常标签
    const r = await fetch('/api/tags/orphans/clear-path', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({paths})});
    const d = await r.json();
    if (!d.ok) { alert('操作失败: ' + (d.error || '')); return; }
    // 打开多选追加标签弹窗（异常标签的 id 用于弹窗警示，但这里只追加新标签）
    selected.clear();
    if (typeof openTagModal === 'function') {
      openTagModal(paths, 'file', 'add');
    }
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

// ---------- 待审核操作 ----------

async function reviewGroup(path, accept) {
  const g = (pendingGroups || []).find(x => x.path === path);
  const ids = g ? (g.ids || [g.id]) : [];
  if (!ids.length) { refreshReviewView(); return; }
  try {
    const rr = await fetch('/api/v1/tags/review', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids, accept})});
    const dd = await rr.json();
    if (!dd.ok) { alert('操作失败: ' + (dd.error || '')); return; }
    refreshReviewView();
    if (typeof loadTags === 'function') loadTags();
  } catch (e) { alert('操作失败: ' + e.message); }
}

async function reviewAll(accept) {
  const ids = [];
  (pendingGroups || []).forEach(x => { (x.ids || [x.id]).forEach(i => ids.push(i)); });
  if (!ids.length) { refreshReviewView(); return; }
  try {
    const rr = await fetch('/api/v1/tags/review', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids, accept})});
    const dd = await rr.json();
    if (!dd.ok) { alert('操作失败: ' + (dd.error || '')); return; }
    refreshReviewView();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

// ---------- 标签异常操作 ----------

async function removeOrphan(path) {
  if (!confirm('确定移除该文件上的父级标签吗？')) return;
  try {
    const rr = await fetch('/api/tags/orphans/clear-path', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path})});
    const dd = await rr.json();
    if (!dd.ok) { alert('操作失败: ' + (dd.error || '')); return; }
    refreshReviewView();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

// ---------- 刷新 ----------

async function refreshReviewView() {
  const seq = taskViewSeq;
  if (taskViewMode === 'review') {
    const r = await fetch('/api/v1/tags/pending');
    const d = await r.json();
    if (seq !== taskViewSeq) return;
    if (d.ok) pendingGroups = d.items || [];
    refreshPendingBadge();
  } else if (taskViewMode === 'orphan') {
    const r = await fetch(`/api/tags/orphans?offset=${orphanPage * orphanLimit}&limit=${orphanLimit}`);
    const d = await r.json();
    if (seq !== taskViewSeq) return;
    if (d.ok) {
      orphanTotal = d.total || d.count || 0;
      pendingGroups = _orphanToGroups(d.items);
    }
    updateOrphanOrderedKeys();
    refreshOrphanBadge();
  }
  // 处理完后队列已空 → 自动退出
  if (taskViewMode && !pendingGroups.length) {
    exitTaskView();
    return;
  }
  if (taskViewMode) {
    renderTaskBanner();
    renderOrphanPager();
    renderTaskGrid();
  }
}

refreshPendingBadge();
refreshOrphanBadge();

// 标签树刷新/拖动后同步孤儿角标
document.addEventListener('DOMContentLoaded', function () {
  const tree = $('#tag-tree');
  if (tree && tree.length) {
    tree.on('refresh.jstree', function () { refreshOrphanBadge(); });
    tree.on('move_node.jstree', function () { setTimeout(refreshOrphanBadge, 400); });
  }
});
