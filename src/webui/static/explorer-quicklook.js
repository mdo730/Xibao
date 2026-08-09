// ---- QuickLook 空格快速预览 ----
let _qlItem = null;
function toggleQuickLook(item) {
  if (_qlItem && _qlItem.path === item.path) { closeQuickLook(); return; }
  openQuickLook(item);
}
function openQuickLook(item) {
  _qlItem = item;
  let modal = document.getElementById('quicklook-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quicklook-modal';
    modal.className = 'quicklook-modal hidden';
    modal.innerHTML = '<div class="quicklook-box"><div class="quicklook-head"><span id="quicklook-name"></span><button class="modal-x" onclick="closeQuickLook()">×</button></div><div id="quicklook-body" class="quicklook-body"></div></div>';
    modal.addEventListener('click', e => { if (e.target === modal) closeQuickLook(); });
    document.body.appendChild(modal);
  }
  modal.classList.remove('hidden');
  document.getElementById('quicklook-name').textContent = item.name;
  const body = document.getElementById('quicklook-body');
  body.innerHTML = '<div class="ql-loading">加载中…</div>';
  const p = item.path;
  if (item.type === 'image') {
    body.innerHTML = `<img class="ql-image" src="${relUrl(p)}">`;
  } else if (item.type === 'video') {
    body.innerHTML = `<video class="ql-video" src="${relUrl(p)}" controls autoplay></video>`;
  } else {
    // 尝试文本预览
    fetch('/api/file/text?key=' + encodeURIComponent(p))
      .then(r => r.json())
      .then(d => {
        if (d.ok) {
          body.innerHTML = `<pre class="ql-text">${d.text}</pre>`;
        } else {
          body.innerHTML = `<div class="ql-nopreview">📄 ${item.name}<br><span class="muted">${d.error || '该类型不支持预览'}</span></div>`;
        }
      })
      .catch(() => { body.innerHTML = '<div class="ql-nopreview">无法预览</div>'; });
  }
}
function closeQuickLook() {
  const modal = document.getElementById('quicklook-modal');
  if (modal && !modal.classList.contains('hidden')) modal.classList.add('hidden');
  _qlItem = null;
}
