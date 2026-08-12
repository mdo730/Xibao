// ---- 通用导航+分页套件（v0.6.1 基准）----
// 所有分页场景（平铺/普通浏览/标签筛选/异常区）统一用此套件：
//   顶部导航栏 = 标题 + 类型过滤按钮 + 分页控件（上/下/跳转/每页数）+ 计数，sticky 置顶
//   底部同步分页条 = 上/下/跳转/每页数
// 每页数量全局记忆（localStorage）

const PAGE_LIMIT_KEY = 'xibao_page_limit';
const PAGE_LIMIT_DEFAULT = 300;

function pageLimit() {
  const v = parseInt(localStorage.getItem(PAGE_LIMIT_KEY) || '0', 10);
  if (v >= 20 && v <= 2000) return v;
  return PAGE_LIMIT_DEFAULT;
}
function setPageLimit(n) {
  localStorage.setItem(PAGE_LIMIT_KEY, String(n));
}

// scope 注册表：各场景注册状态与回调
const pgScopes = {};

// scope: 唯一名；handlers: {get(), prev(), next(), jump(offset), size(limit)}
function pgRegister(scope, handlers) {
  pgScopes[scope] = handlers;
}

function pgGet(scope) {
  const h = pgScopes[scope];
  return h ? h.get() : {total: 0, offset: 0, limit: pageLimit()};
}
function pgPrev(scope) { const h = pgScopes[scope]; if (h && h.prev) h.prev(); }
function pgNext(scope) { const h = pgScopes[scope]; if (h && h.next) h.next(); }
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

// 生成分页控件 HTML（上/下/跳转/每页数）——顶部/底部分页条共用
function pagerControlsHtml(scope) {
  const s = pgGet(scope);
  const total = s.total || 0;
  const limit = s.limit || pageLimit();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const curPage = Math.floor((s.offset || 0) / limit) + 1;
  const prevDis = curPage <= 1 ? 'disabled' : '';
  const nextDis = curPage >= totalPages ? 'disabled' : '';
  return `<span class="pg-nav">
      <button class="mini" ${prevDis} onclick="pgPrev('${scope}')">←</button>
      <span class="pg-jump">第 <input class="pg-input pg-jump-input" type="number" min="1" max="${totalPages}" value="${curPage}" onchange="pgJump('${scope}', this.value)">/${totalPages} 页</span>
      <button class="mini" ${nextDis} onclick="pgNext('${scope}')">→</button>
    </span>
    <span class="pg-size">每页 <input class="pg-input pg-size-input" type="number" min="20" max="2000" value="${limit}" onchange="pgSizeChange('${scope}', this.value)"> 个</span>`;
}

// 顶部 banner（flatten-banner 样式，sticky 置顶）：标题 + 类型过滤 + 计数 + 分页控件 + 模式专属操作
// cfg: {title, types:[['key','label']], onType, actions}
function pgRenderBanner(scope, cfg) {
  const body = document.getElementById('explorer-body');
  let nav = document.getElementById('pg-nav-' + scope);
  if (!nav) {
    nav = document.createElement('div');
    nav.id = 'pg-nav-' + scope;
    nav.className = 'flatten-banner pg-sticky';
    body.insertBefore(nav, body.firstChild);
  }
  const s = pgGet(scope);
  const typeBtns = (cfg.types || []).map(([v, l]) =>
    `<button class="mini ${s.type === v ? 'active' : ''}" onclick="${cfg.onType}('${v}')">${l}</button>`).join('');
  const controls = s.total ? pagerControlsHtml(scope) : '';
  nav.innerHTML = `<span class="flatten-title">${cfg.title || ''}</span>
    ${typeBtns ? `<span class="flatten-type">${typeBtns}</span>` : ''}
    ${s.total ? `<span class="pg-info">共 ${s.total} 项</span>` : ''}
    ${controls}
    <span class="flatten-actions">${cfg.actions || ''}</span>`;
}

// 底部同步基础分页条
function pgRenderBottom(scope) {
  const body = document.getElementById('explorer-body');
  let bottom = document.getElementById('pg-bottom-' + scope);
  if (!bottom) {
    bottom = document.createElement('div');
    bottom.id = 'pg-bottom-' + scope;
    bottom.className = 'flatten-pager';
    body.appendChild(bottom);
  }
  bottom.innerHTML = pagerControlsHtml(scope);
}

// 渲染 banner（含分页控件，置顶）+ 底部同步分页条（total>0 才显示分页控件）
function pgRender(scope, cfg) {
  pgRenderBanner(scope, cfg);
  const s = pgGet(scope);
  if (!s.total) return;
  pgRenderBottom(scope);
}

// 清理
function pgRemove(scope) {
  ['nav', 'bottom'].forEach(kind => {
    const el = document.getElementById('pg-' + kind + '-' + scope);
    if (el) el.remove();
  });
  delete pgScopes[scope];
}
