// ---- 统一任务视图（v0.6.0 第 8 步）----
// 两种模式共用同一套缩略图卡片视图，仅操作按钮不同：
//   reviewMode（待审核）: 接受 / 拒绝
//   orphanMode（标签异常）: 修改标签 / 移除标签
let taskViewMode = null;   // 'review' | 'orphan' | null
let pendingGroups = [];
let taskViewSeq = 0;       // 切换序号：防止异步 refresh 覆盖新视图

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
  ['btn-pending-review', 'btn-tag-orphans'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.remove('active');
  });
  const banner = document.getElementById('review-banner');
  if (banner) banner.remove();
  if (typeof refresh === 'function') refresh();
}

async function enterReviewView(seq) {
  const r = await fetch('/api/v1/tags/pending');
  const d = await r.json();
  if (seq !== undefined && seq !== taskViewSeq) return;
  if (!d.ok) { alert('加载待审核失败: ' + (d.error || '')); taskViewMode = null; return; }
  pendingGroups = d.items || [];
  const btn = document.getElementById('btn-pending-review');
  if (btn) btn.classList.add('active');
  renderTaskBanner();
  renderTaskGrid();
}

function _orphanToGroups(items) {
  return (items || []).map(it => ({
    path: it.path,
    type: _guessType(it.path),
    ids: [it.tag_id],
    tags: [{name: it.tag, parent: null, source: '父级标签'}],
  }));
}

async function enterOrphanView(seq) {
  const r = await fetch('/api/tags/orphans');
  const d = await r.json();
  if (seq !== undefined && seq !== taskViewSeq) return;
  if (!d.ok) { alert('加载标签异常失败: ' + (d.error || '')); taskViewMode = null; return; }
  pendingGroups = _orphanToGroups(d.items);
  const btn = document.getElementById('btn-tag-orphans');
  if (btn) btn.classList.add('active');
  renderTaskBanner();
  renderTaskGrid();
  refreshOrphanBadge();
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
    : `<button class="mini danger" onclick="clearOrphans()">🗑 一键清理</button>`;
  banner.innerHTML = `<span class="review-banner-title">${title}</span>
    <span class="muted" id="review-banner-count">${countText}</span>
    <span class="review-banner-actions">
      ${allBtn}
      <button class="mini" onclick="exitTaskView()">✕ 退出</button>
    </span>`;
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
  for (const g of pendingGroups) {
    const card = document.createElement('div');
    card.className = 'cell cell-file review-card';
    card.dataset.path = g.path;
    let display = '';
    if (g.type === 'image') {
      display = `<img class="cell-thumb" src="${relUrl(g.path)}" loading="lazy">`;
    } else if (g.type === 'video') {
      display = `<img class="cell-thumb video-thumb" src="/api/thumb?path=${encodeURIComponent(g.path)}&size=256" loading="lazy">`;
    } else {
      display = fileIconHtml(basename(g.path), 'cell-icon-img', 'cell-icon', iconOf('other'), g.path);
    }
    const tagsHtml = g.tags.map(t =>
      `<span class="review-tag">${escHtml((t.parent ? t.parent + ' > ' : '') + t.name)}</span>`).join('');
    const srcs = [...new Set(g.tags.map(t => t.source || 'external'))].join(',');
    const isReview = taskViewMode === 'review';
    const actions = isReview
      ? `<button class="mini ok" onclick="reviewGroup('${escAttr(g.path)}', true)">✅ 接受</button>
         <button class="mini danger" onclick="reviewGroup('${escAttr(g.path)}', false)">🗑 拒绝</button>`
      : `<button class="mini" onclick="openTagModal('${escAttr(g.path)}', 'file', 'set')">✏️ 修改标签</button>
         <button class="mini danger" onclick="removeOrphan('${escAttr(g.path)}')">🗑 移除标签</button>`;
    card.innerHTML = `
      <div class="cell-content">${display}</div>
      <div class="cell-name">${escHtml(basename(g.path))}</div>
      <div class="review-card-tags">${tagsHtml || '<span class="muted">无标签</span>'}</div>
      <div class="review-card-meta muted">${isReview ? '来源: ' + escHtml(srcs) : '父级标签（编辑弹窗不可勾选）'}</div>
      <div class="review-card-actions">${actions}</div>`;
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

async function clearOrphans() {
  if (!confirm('确定清理所有「无法管理」的父级标签吗？\n\n将移除文件上这些父级标签的关联。')) return;
  try {
    const r = await fetch('/api/tags/orphans/clear', {method: 'POST'});
    const d = await r.json();
    if (!d.ok) { alert('清理失败: ' + (d.error || '')); return; }
    alert('已清理 ' + d.cleared + ' 个父级标签关联');
    refreshReviewView();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('清理失败: ' + e.message); }
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
    const r = await fetch('/api/tags/orphans');
    const d = await r.json();
    if (seq !== taskViewSeq) return;
    if (d.ok) pendingGroups = _orphanToGroups(d.items);
    refreshOrphanBadge();
  }
  // 处理完后队列已空 → 自动退出
  if (taskViewMode && !pendingGroups.length) {
    exitTaskView();
    return;
  }
  if (taskViewMode) {
    renderTaskBanner();
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
