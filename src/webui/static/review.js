// ---- 外部写入待审核（v0.6.0 第 8 步）----
// 点「待审核」进入审核视图，文件列表以缩略图卡片显示待审核文件
let reviewMode = false;
let pendingGroups = [];

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

// 进入审核视图：切换标志并重新渲染文件列表
function toggleReviewMode() {
  reviewMode = !reviewMode;
  if (reviewMode) {
    enterReviewView();
  } else {
    exitReviewView();
  }
}

async function enterReviewView() {
  const r = await fetch('/api/v1/tags/pending');
  const d = await r.json();
  if (!d.ok) { alert('加载待审核失败: ' + (d.error || '')); reviewMode = false; return; }
  pendingGroups = d.items || [];
  const btn = document.getElementById('btn-pending-review');
  if (btn) btn.classList.add('active');
  renderReviewBanner();
  renderReviewGrid();
}

function exitReviewView() {
  reviewMode = false;
  const btn = document.getElementById('btn-pending-review');
  if (btn) btn.classList.remove('active');
  const banner = document.getElementById('review-banner');
  if (banner) banner.remove();
  if (typeof refresh === 'function') refresh();
}

function renderReviewBanner() {
  let banner = document.getElementById('review-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'review-banner';
    banner.className = 'review-banner';
    const body = document.getElementById('explorer-body');
    body.insertBefore(banner, body.firstChild);
  }
  banner.innerHTML = `<span class="review-banner-title">🕓 待审核</span>
    <span class="muted" id="review-banner-count">${pendingGroups.length} 个文件</span>
    <span class="review-banner-actions">
      <button class="mini ok" onclick="reviewAll(true)">✅ 全部接受</button>
      <button class="mini danger" onclick="reviewAll(false)">🗑 全部拒绝</button>
      <button class="mini" onclick="toggleReviewMode()">✕ 退出</button>
    </span>`;
}

// 审核视图：缩略图卡片（复用文件列表的缩略图逻辑）
function renderReviewGrid() {
  const grid = document.getElementById('item-grid');
  if (!grid) return;
  grid.className = 'grid-view';
  grid.innerHTML = '';
  if (!pendingGroups.length) {
    grid.innerHTML = '<div class="review-empty"><div>没有待审核的写入 🎉</div><button class="mini" style="margin-top:12px" onclick="toggleReviewMode()">退出审核</button></div>';
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
    card.innerHTML = `
      <div class="cell-content">${display}</div>
      <div class="cell-name">${escHtml(basename(g.path))}</div>
      <div class="review-card-tags">${tagsHtml || '<span class="muted">无标签</span>'}</div>
      <div class="review-card-meta muted">来源: ${escHtml(srcs)}</div>
      <div class="review-card-actions">
        <button class="mini ok" onclick="reviewGroup('${escAttr(g.path)}', true)">✅ 接受</button>
        <button class="mini danger" onclick="reviewGroup('${escAttr(g.path)}', false)">🗑 拒绝</button>
      </div>`;
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

// 按文件路径审核（该文件的所有待审核标签一起处理）
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

// 重新拉取并刷新审核视图（处理完自动退出）
async function refreshReviewView() {
  const r = await fetch('/api/v1/tags/pending');
  const d = await r.json();
  if (!d.ok) return;
  pendingGroups = d.items || [];
  refreshPendingBadge();
  if (reviewMode) {
    // 处理完后队列已空 → 自动退出，回到进入前的位置
    if (!pendingGroups.length) {
      exitReviewView();
      return;
    }
    renderReviewBanner();
    renderReviewGrid();
  }
}

refreshPendingBadge();
