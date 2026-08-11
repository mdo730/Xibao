// ---- 外部写入待审核（v0.6.0 第 8 步）----
let pendingItems = [];

async function refreshPendingBadge() {
  try {
    const r = await fetch('/api/v1/tags/pending');
    const d = await r.json();
    if (!d.ok) return;
    const badge = document.getElementById('pending-badge');
    if (badge) {
      badge.textContent = d.count || 0;
      badge.classList.toggle('hidden', !d.count);
    }
  } catch (e) { /* 忽略 */ }
}

async function openReviewModal() {
  modalShow(document.getElementById('review-modal'));
  const listEl = document.getElementById('review-list');
  listEl.innerHTML = '<div class="muted" style="padding:20px;text-align:center">加载中…</div>';
  try {
    const r = await fetch('/api/v1/tags/pending');
    const d = await r.json();
    if (!d.ok) { listEl.innerHTML = '<div class="muted" style="padding:20px">加载失败</div>'; return; }
    pendingItems = d.items || [];
    renderReviewList();
  } catch (e) {
    listEl.innerHTML = '<div class="muted" style="padding:20px">加载失败: ' + e.message + '</div>';
  }
}
function closeReviewModal() {
  modalHide(document.getElementById('review-modal'));
}

function renderReviewList() {
  const listEl = document.getElementById('review-list');
  const summary = document.getElementById('review-summary');
  if (!pendingItems.length) {
    listEl.innerHTML = '<div class="muted" style="padding:30px;text-align:center">没有待审核的写入 🎉</div>';
    if (summary) summary.textContent = '';
    return;
  }
  let html = '';
  for (const it of pendingItems) {
    const parent = it.parent_name ? it.parent_name + ' > ' : '';
    html += `<div class="review-item" data-id="${it.id}">
      <div class="review-main">
        <div class="review-path" title="${escHtml(it.folder_path)}">${escHtml(it.folder_path)}</div>
        <div class="review-tags">
          <span class="review-tag">${escHtml(parent + it.tag_name)}</span>
          <span class="muted" style="font-size:11px">来源: ${escHtml(it.source || 'external')}</span>
        </div>
      </div>
      <div class="review-actions">
        <button class="mini ok" onclick="reviewOne(${it.id}, true)">✅ 接受</button>
        <button class="mini danger" onclick="reviewOne(${it.id}, false)">🗑 拒绝</button>
      </div>
    </div>`;
  }
  listEl.innerHTML = html;
  if (summary) summary.textContent = `共 ${pendingItems.length} 条待审核`;
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

async function reviewOne(id, accept) {
  try {
    const r = await fetch('/api/v1/tags/review', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids: [id], accept})});
    const d = await r.json();
    if (!d.ok) { alert('操作失败: ' + (d.error || '')); return; }
    pendingItems = pendingItems.filter(x => x.id !== id);
    renderReviewList();
    refreshPendingBadge();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

async function reviewAll(accept) {
  if (!pendingItems.length) return;
  const ids = pendingItems.map(x => x.id);
  try {
    const r = await fetch('/api/v1/tags/review', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ids, accept})});
    const d = await r.json();
    if (!d.ok) { alert('操作失败: ' + (d.error || '')); return; }
    pendingItems = [];
    renderReviewList();
    refreshPendingBadge();
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('操作失败: ' + e.message); }
}

async function clearReviewed() {
  try {
    await fetch('/api/v1/tags/pending/clear', {method: 'POST'});
  } catch (e) { /* 忽略 */ }
}

refreshPendingBadge();
