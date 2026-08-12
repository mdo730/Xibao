// ---- 框选（marquee）——自 explorer-core.js 拆分 ----
// 依赖全局：selected、updateSelectionUI（core）、taskViewMode/renderOrphanActionBar（review.js）
// 加载顺序：必须在 explorer-core.js 之后（core 定义 selected 全局状态）

let _marquee = null;
let _marqueeStart = null;
let _marqueeEl = null;
// 框选自动滚动：鼠标压住容器上下边缘时持续滚动
// 框选全部用内容坐标（client + scrollTop），滚动不影响坐标基准，无需在滚动循环里调整
let _marqueeScrollRAF = null;
let _marqueeScrollSpeed = 0;
function _marqueeScrollStop() {
  if (_marqueeScrollRAF) { cancelAnimationFrame(_marqueeScrollRAF); _marqueeScrollRAF = null; }
  _marqueeScrollSpeed = 0;
}
function _marqueeScrollLoop() {
  _marqueeScrollRAF = requestAnimationFrame(() => {
    if (!_marquee || !_marqueeScrollSpeed) { _marqueeScrollRAF = null; return; }
    const bodyEl = document.getElementById('explorer-body');
    if (bodyEl) bodyEl.scrollTop += _marqueeScrollSpeed;
    updateMarquee();
    _marqueeScrollLoop();
  });
}
function _marqueeUpdateScroll(clientY, bodyEl) {
  if (!bodyEl || !_marquee) return;
  const r = bodyEl.getBoundingClientRect();
  const edge = 32;
  if (clientY < r.top + edge) {
    // 向上滚动（速度随深度）
    const d = (r.top + edge - clientY) / edge;
    _marqueeScrollSpeed = -Math.round(8 + d * 26);
    if (!_marqueeScrollRAF) _marqueeScrollLoop();
  } else if (clientY > r.bottom - edge) {
    const d = (clientY - (r.bottom - edge)) / edge;
    _marqueeScrollSpeed = Math.round(8 + d * 26);
    if (!_marqueeScrollRAF) _marqueeScrollLoop();
  } else {
    _marqueeScrollStop();
  }
}
function initMarquee() {
  const bodyEl = document.getElementById('explorer-body');
  _marqueeEl = document.createElement('div');
  _marqueeEl.className = 'marquee-box';
  _marqueeEl.style.display = 'none';
  bodyEl.appendChild(_marqueeEl);
  bodyEl.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.cell') || e.target.closest('tr') || e.target.closest('.scroll-sentinel')) return;
    // 内容坐标：client + scrollTop，滚动不影响基准
    _marqueeStart = {x: e.clientX, y: e.clientY + bodyEl.scrollTop};
    _marquee = {x: e.clientX, y: e.clientY + bodyEl.scrollTop, w: 0, h: 0};
    _marqueeEl.style.display = 'block';
    updateMarquee();
  });
  document.addEventListener('mousemove', e => {
    if (!_marquee || !_marqueeStart) return;
    const cy = e.clientY + bodyEl.scrollTop;
    _marquee = {
      x: Math.min(e.clientX, _marqueeStart.x),
      y: Math.min(cy, _marqueeStart.y),
      w: Math.abs(e.clientX - _marqueeStart.x),
      h: Math.abs(cy - _marqueeStart.y),
    };
    _marqueeUpdateScroll(e.clientY, bodyEl);
    updateMarquee();
  });
  document.addEventListener('mouseup', () => {
    if (!_marquee) return;
    const wasClick = _marquee.w < 4 && _marquee.h < 4;
    _marqueeEl.style.display = 'none';
    _marquee = null; _marqueeStart = null;
    _marqueeScrollStop();
    if (wasClick) {
      // 点击空白：取消所有选择
      selected.clear();
      updateSelectionUI();
    }
  });
}
let _marqueeRAF = null;
function updateMarquee() {
  if (_marqueeRAF) return; // 已排队的 rAF 帧，合并本次更新
  _marqueeRAF = requestAnimationFrame(() => {
    _marqueeRAF = null;
    if (!_marquee) { // mouseup 已结束但 rAF 帧才执行：隐藏框避免残留
      _marqueeEl.style.display = 'none';
      return;
    }
    const bodyEl = document.getElementById('explorer-body');
    const st = bodyEl ? bodyEl.scrollTop : 0;
    _marqueeEl.style.display = 'block';
    _marqueeEl.style.left = _marquee.x + 'px';
    _marqueeEl.style.top = (_marquee.y - st) + 'px';   // 内容坐标 → 视口坐标显示
    _marqueeEl.style.width = _marquee.w + 'px';
    _marqueeEl.style.height = _marquee.h + 'px';
    if (_marquee.w < 4 && _marquee.h < 4) return; // 太小当作点击
    // 计算与哪些 cell 相交：marquee 是内容坐标，cell rect 转内容坐标统一基准
    selected.clear();
    const rect = {x: _marquee.x, y: _marquee.y, w: _marquee.w, h: _marquee.h};
    const els = document.querySelectorAll('.cell, .list-view tr');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const r = el.getBoundingClientRect();
      const ry = r.top + st, rb = r.bottom + st;
      const overlap = !(r.right < rect.x || r.left > rect.x + rect.w || rb < rect.y || ry > rect.y + rect.h);
      if (overlap && el.dataset.key) selected.add(el.dataset.key);
    }
    // 批量写 class，避免逐元素读写交错布局
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      el.classList.toggle('sel', el.dataset.key && selected.has(el.dataset.key));
    }
    // 异常模式下同步底部操作栏的"已选 N 项"
    if (typeof taskViewMode !== 'undefined' && taskViewMode === 'orphan' &&
        typeof renderOrphanActionBar === 'function') {
      renderOrphanActionBar();
    }
  });
}
initMarquee();
