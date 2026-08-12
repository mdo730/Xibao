// ---- 通用分页组件（v0.6.1 基准）----
// 所有涉及分页的功能统一用此组件：平铺/异常区/普通浏览大目录
// 特性：顶部+底部各一组分页条、sticky 置顶、页码跳转、每页数量输入、数量记忆

const PAGE_LIMIT_KEY = 'xibao_page_limit';
const PAGE_LIMIT_DEFAULT = 300;

// 每页数量（全局偏好，设置可改）
function pageLimit() {
  const v = parseInt(localStorage.getItem(PAGE_LIMIT_KEY) || '0', 10);
  if (v >= 20 && v <= 2000) return v;
  return PAGE_LIMIT_DEFAULT;
}
function setPageLimit(n) {
  localStorage.setItem(PAGE_LIMIT_KEY, String(n));
}

// 分页状态注册表：各功能注册 scope 和回调
const pgScopes = {};

// 注册分页场景
// scope: 唯一名；handlers: {get(), prev(), next(), jump(offset), size(limit)}
function pgRegister(scope, handlers) {
  pgScopes[scope] = handlers;
}

function pgGet(scope) {
  const h = pgScopes[scope];
  return h ? h.get() : {total: 0, offset: 0, limit: pageLimit()};
}

function pgPrev(scope) {
  const h = pgScopes[scope];
  if (h && h.prev) h.prev();
}
function pgNext(scope) {
  const h = pgScopes[scope];
  if (h && h.next) h.next();
}
function pgJump(scope, pageVal) {
  const h = pgScopes[scope];
  if (!h) return;
  const s = pgGet(scope);
  const v = parseInt(pageVal, 10);
  const totalPages = Math.max(1, Math.ceil(s.total / s.limit));
  if (isNaN(v) || v < 1 || v > totalPages) return;
  if (h.jump) h.jump((v - 1) * s.limit);
}
function pgSizeChange(scope, val) {
  const h = pgScopes[scope];
  if (!h) return;
  const v = parseInt(val, 10);
  if (isNaN(v) || v < 20 || v > 2000) return;
  setPageLimit(v);
  if (h.size) h.size(v);
}

// 渲染一组分页条（top/bottom 同内容）
function renderPagerBar(container, scope) {
  const s = pgGet(scope);
  const total = s.total || 0;
  const limit = s.limit || pageLimit();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const curPage = Math.floor((s.offset || 0) / limit) + 1;
  const prevDis = curPage <= 1 ? 'disabled' : '';
  const nextDis = curPage >= totalPages ? 'disabled' : '';
  container.innerHTML = `
    <span class="pg-info">第 ${curPage} / ${totalPages} 页 · 共 ${total} 项</span>
    <span class="pg-nav">
      <button class="mini" ${prevDis} onclick="pgPrev('${scope}')">← 上一页</button>
      <span class="pg-jump">第 <input class="pg-input" type="number" min="1" max="${totalPages}" value="${curPage}" onchange="pgJump('${scope}', this.value)"> 页</span>
      <button class="mini" ${nextDis} onclick="pgNext('${scope}')">下一页 →</button>
    </span>
    <span class="pg-size">每页 <input class="pg-input" type="number" min="20" max="2000" value="${limit}" onchange="pgSizeChange('${scope}', this.value)"> 个</span>`;
}

// 渲染顶部+底部两组分页条；无 total 时不显示
function renderPager(scope) {
  const s = pgGet(scope);
  if (!s.total) return;
  const top = document.getElementById('pg-top-' + scope);
  const bottom = document.getElementById('pg-bottom-' + scope);
  if (top) renderPagerBar(top, scope);
  if (bottom) renderPagerBar(bottom, scope);
}

// 清理分页条（退出分页模式时）
function pgRemove(scope) {
  ['top', 'bottom'].forEach(pos => {
    const el = document.getElementById('pg-' + pos + '-' + scope);
    if (el) el.remove();
  });
  delete pgScopes[scope];
}
