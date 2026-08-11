/* 设置弹窗：搜索配置 + 动画开关 + 标签迁移开关 */
function openSettingsModal() {
  modalShow(document.getElementById('settings-modal'));
  setLoadSearch();
  const cb = document.getElementById('set-animations');
  if (cb) cb.checked = localStorage.getItem('xibao_animations') !== '0';
  loadMigrateSetting();
  renderChipsSettingUI();
  updateAliasColorPreview();
  renderKnownFoldersSettingUI();
  loadExternalSecurity();
}
function closeSettingsModal() {
  modalHide(document.getElementById('settings-modal'));
}
function saveAnimSetting() {
  const cb = document.getElementById('set-animations');
  const on = !!cb.checked;
  localStorage.setItem('xibao_animations', on ? '1' : '0');
  document.body.classList.toggle('no-animation', !on);
}
function applyAnimSetting() {
  const on = localStorage.getItem('xibao_animations') !== '0';
  document.body.classList.toggle('no-animation', !on);
}
applyAnimSetting();

// ---- 标签迁移开关（存后端 meta） ----
async function loadMigrateSetting() {
  try {
    const r = await fetch('/api/meta/migrate_tags_on_move');
    const d = await r.json();
    const cb = document.getElementById('set-migrate-tags');
    if (cb) cb.checked = d.ok && d.value === '1';
  } catch (e) { /* 忽略 */ }
}
async function saveMigrateSetting() {
  const cb = document.getElementById('set-migrate-tags');
  const on = !!(cb && cb.checked);
  try {
    await fetch('/api/meta/migrate_tags_on_move', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({value: on ? '1' : '0'}),
    });
  } catch (e) { /* 忽略 */ }
}

// ---- 筛选胶囊位置 + 尺寸（localStorage；chipsPos/chipsSize 定义在 explorer-tags-jstree.js） ----
function setChipsPos(pos) {
  localStorage.setItem('xibao_chips_pos', pos);
  renderChipsSettingUI();
  if (typeof renderFilterChips === 'function') renderFilterChips();
}
function setChipsSize(size) {
  localStorage.setItem('xibao_chips_size', size);
  renderChipsSettingUI();
  if (typeof renderFilterChips === 'function') renderFilterChips();
}
function renderChipsSettingUI() {
  const pos = chipsPos();
  [['tree', 'btn-chips-pos-tree'], ['top', 'btn-chips-pos-top']].forEach(([val, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', pos === val);
  });
  const size = chipsSize();
  [['sm', 'btn-chips-size-sm'], ['md', 'btn-chips-size-md'], ['lg', 'btn-chips-size-lg']].forEach(([val, id]) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', size === val);
  });
}

// ---- 文件树：系统文件夹开关 + 保留项（localStorage） ----
const KNOWN_KEY = 'xibao_known_folders';
const KNOWN_LABELS = {Desktop: '桌面', Downloads: '下载', Pictures: '图片', Videos: '视频',
  Documents: '文档', Music: '音乐', ProgramData: '程序数据', Public: '公共'};
const KNOWN_ICONS = {Desktop: '🖥', Downloads: '⬇', Pictures: '🖼', Videos: '🎬',
  Documents: '📄', Music: '🎵', ProgramData: '🗂', Public: '👥'};
function knownFoldersSetting() {
  try {
    const v = JSON.parse(localStorage.getItem(KNOWN_KEY) || 'null');
    if (v) return v;
  } catch (e) { /* 忽略 */ }
  return {on: true, list: []};
}
function saveKnownFoldersSetting() {
  const cb = document.getElementById('set-known-folders');
  const on = !!(cb && cb.checked);
  const checks = document.querySelectorAll('#set-known-folders-list input[type=checkbox]');
  const list = [];
  checks.forEach(c => { if (c.checked) list.push(c.dataset.name); });
  localStorage.setItem(KNOWN_KEY, JSON.stringify({on, list}));
  if (typeof loadFileTree === 'function') loadFileTree();
}
async function renderKnownFoldersSettingUI() {
  const wrap = document.getElementById('set-known-folders-list');
  if (!wrap) return;
  const s = knownFoldersSetting();
  const cb = document.getElementById('set-known-folders');
  if (cb) cb.checked = s.on;
  // 从后端拿真实存在的 Known Folders
  try {
    const r = await fetch('/api/filetree');
    const d = await r.json();
    if (!d.ok) throw new Error('bad');
    const known = d.tree.filter(n => n.is_known);
    const sorted = Object.keys(KNOWN_LABELS)
      .map(name => known.find(n => n.name === name))
      .filter(Boolean);
    wrap.innerHTML = '';
    // 两列紧凑排列，只显示 emoji + 名字（不显示路径）
    wrap.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0 16px';
    sorted.forEach(n => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;padding:1px 0;cursor:pointer';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.name = n.name;
      input.checked = !(s.list && s.list.length) || s.list.includes(n.name);
      input.style.width = 'auto';
      input.style.margin = '0';
      input.onchange = saveKnownFoldersSetting;
      label.appendChild(input);
      label.appendChild(document.createTextNode((KNOWN_ICONS[n.name] || '📁') + ' ' + (KNOWN_LABELS[n.name] || n.name)));
      wrap.appendChild(label);
    });
  } catch (e) {
    wrap.innerHTML = '<div class="muted">无法加载系统文件夹列表</div>';
  }
}

// ---- 外部写入安全区 + 审核（meta 存后端） ----
async function loadExternalSecurity() {
  try {
    const r = await fetch('/api/v1/security');
    const d = await r.json();
    if (!d.ok) return;
    const roots = document.getElementById('set-allow-roots');
    if (roots) roots.value = (d.roots || []).join(', ');
    const audit = document.getElementById('set-ext-audit');
    if (audit) audit.checked = !!d.audit;
  } catch (e) { /* 忽略 */ }
}
async function saveExternalSecurity() {
  const rootsEl = document.getElementById('set-allow-roots');
  const auditEl = document.getElementById('set-ext-audit');
  const roots = rootsEl ? rootsEl.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
  const audit = !!(auditEl && auditEl.checked);
  const status = document.getElementById('set-ext-status');
  if (status) { status.textContent = '⏳ 保存中…'; status.className = 'search-feedback'; }
  try {
    const r = await fetch('/api/v1/security', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({roots, audit})});
    const d = await r.json();
    if (!d.ok) {
      if (status) { status.textContent = '❌ ' + (d.error || '保存失败'); status.className = 'search-feedback fail'; }
      loadExternalSecurity();
      return;
    }
    if (status) { status.textContent = '✅ 已保存'; status.className = 'search-feedback ok'; }
  } catch (e) {
    if (status) { status.textContent = '❌ 保存失败: ' + e.message; status.className = 'search-feedback fail'; }
  }
}

// ---- 清理无效挂载（外部删除/移动文件后残留的标签关联） ----
async function cleanupInvalidMounts() {
  if (!confirm('确定清理无效挂载吗？\n\n将移除已不存在文件/文件夹上的标签与备注名。\n\n注意：如果外接盘/网络盘当前未连接，其文件也会被误判为不存在，清理后重新连接也不会恢复。')) return;
  const s = document.getElementById('set-cleanup-status');
  if (s) { s.textContent = '⏳ 清理中…'; s.className = 'search-feedback'; }
  try {
    const r = await fetch('/api/tags/cleanup-invalid', {method: 'POST'});
    const d = await r.json();
    if (!d.ok) {
      if (s) { s.textContent = '❌ ' + (d.error || '清理失败'); s.className = 'search-feedback fail'; }
      return;
    }
    if (s) {
      s.textContent = d.cleaned ? `✅ 已清理 ${d.cleaned} 个无效挂载` : '✅ 没有无效挂载';
      s.className = 'search-feedback ok';
    }
    if (typeof loadTags === 'function') loadTags();
    if (typeof refresh === 'function') refresh();
  } catch (e) {
    if (s) { s.textContent = '❌ 清理失败: ' + e.message; s.className = 'search-feedback fail'; }
  }
}

// ---- 帮助浮窗（可拖动、可关闭） ----
function openHelpFloat(center) {
  const f = document.getElementById('help-float');
  if (!f) return;
  f.classList.remove('hidden');
  if (center) {
    f.style.left = '';
    f.style.top = '';
    f.style.left = Math.max(8, (window.innerWidth - f.offsetWidth) / 2) + 'px';
    f.style.top = Math.max(8, (window.innerHeight - f.offsetHeight) / 2) + 'px';
  }
  // 打开时读取"下次不再提示"勾选状态
  try {
    fetch('/api/help-seen').then(r => r.json()).then(d => {
      const cb = document.getElementById('help-no-more');
      if (cb) cb.checked = !!(d.ok && d.seen);
    }).catch(() => {});
  } catch (e) { /* 忽略 */ }
}
// 每次启动：除非勾了"下次不再提示"，否则弹出帮助
function maybeShowFirstHelp() {
  try {
    fetch('/api/help-seen')
      .then(r => r.json())
      .then(d => {
        if (d.ok && d.seen) return;  // 勾了不再提示，不弹
        setTimeout(() => openHelpFloat(true), 600);
      })
      .catch(() => setTimeout(() => openHelpFloat(true), 600));
  } catch (e) { /* 忽略 */ }
}
// 帮助浮窗"下次不再提示"复选框：勾选存后端
function saveHelpNoMore() {
  const cb = document.getElementById('help-no-more');
  const noMore = !!(cb && cb.checked);
  try {
    fetch('/api/help-seen', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({seen: noMore}),
    }).catch(() => {});
  } catch (e) { /* 忽略 */ }
}
function closeHelpFloat() {
  const f = document.getElementById('help-float');
  if (f) f.classList.add('hidden');
}
(function initHelpDrag() {
  const f = document.getElementById('help-float');
  const head = document.getElementById('help-float-head');
  if (!f || !head) return;
  head.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = f.offsetLeft, oy = f.offsetTop;
    function mv(ev) {
      f.style.left = (ox + ev.clientX - sx) + 'px';
      f.style.top = (oy + ev.clientY - sy) + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
})();

async function setLoadSearch() {
  const el = document.getElementById('set-search-status');
  try {
    const r = await fetch('/api/search/status');
    const d = await r.json();
    if (d.ok) {
      const names = {everything: '⚡ Everything 引擎', usn: '💾 USN 引擎', local: '📁 本地索引'};
      el.textContent = '当前引擎：' + (names[d.engine] || d.engine);
    } else {
      el.textContent = '检测失败：' + (d.error || '');
    }
  } catch (e) {
    el.textContent = '检测失败：' + e.message;
  }
}

async function setConnectEverything() {
  const s = document.getElementById('set-ev-status');
  s.textContent = '⏳ 正在连接…';
  s.className = 'search-feedback';
  try {
    const r = await fetch('/api/search/connect', {method: 'POST'});
    const d = await r.json();
    s.textContent = d.ok ? '✅ 已成功连接 Everything 引擎' : ('❌ ' + (d.message || '连接失败'));
    s.className = 'search-feedback ' + (d.ok ? 'ok' : 'fail');
  } catch (e) {
    s.textContent = '❌ 连接失败：' + e.message;
    s.className = 'search-feedback fail';
  }
  setLoadSearch();
}

async function setBuildIndex() {
  const s = document.getElementById('set-build-status');
  const wrap = document.getElementById('set-index-progress');
  s.textContent = '';
  wrap.classList.remove('hidden');
  await fetch('/api/search/build?mode=full', {method: 'POST'});
  s.textContent = '构建中…';
  setPollProgress();
}

async function setPollProgress() {
  const wrap = document.getElementById('set-index-progress');
  const bar = document.getElementById('set-index-bar');
  const text = document.getElementById('set-index-text');
  const s = document.getElementById('set-build-status');
  for (let i = 0; i < 600; i++) {
    await new Promise(res => setTimeout(res, 1000));
    try {
      const r = await fetch('/api/search/progress');
      const d = await r.json();
      if (!d.running) {
        bar.style.width = '100%';
        text.textContent = d.count ? `扫描完成，共 ${(d.count/10000).toFixed(1)} 万条` : '已完成';
        s.textContent = '✅ 索引构建完成，可在资源管理器搜索';
        setTimeout(() => wrap.classList.add('hidden'), 4000);
        setLoadSearch();
        return;
      }
      const pct = d.percent || (d.drive ? 50 : 0);
      bar.style.width = pct + '%';
      text.textContent = `扫描中${d.drive ? '（' + d.drive + '）' : ''}… 已 ${d.count ? (d.count/10000).toFixed(1) : 0} 万条`;
    } catch (e) {
      text.textContent = '进度读取失败：' + e.message;
    }
  }
  s.textContent = '构建仍在进行，可稍后刷新查看';
}

maybeShowFirstHelp();

// ---- 更新日志浮窗（可拖动、可关闭） ----
function openChangelogFloat() {
  const f = document.getElementById('changelog-float');
  if (!f) return;
  f.classList.remove('hidden');
}
function closeChangelogFloat() {
  const f = document.getElementById('changelog-float');
  if (f) f.classList.add('hidden');
}
(function initChangelogDrag() {
  const f = document.getElementById('changelog-float');
  const head = document.getElementById('changelog-float-head');
  if (!f || !head) return;
  head.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = f.offsetLeft, oy = f.offsetTop;
    function mv(ev) {
      f.style.left = (ox + ev.clientX - sx) + 'px';
      f.style.top = (oy + ev.clientY - sy) + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', mv);
      document.removeEventListener('mouseup', up);
    }
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
})();

// ---- 备注名底色（复用标签树调色板） ----
let _aliasColorMode = false;
function openAliasColorPalette() {
  const colors = (typeof PALETTE !== 'undefined') ? PALETTE : [
    '#ecc889', '#f0c6c6', '#f5d9a8', '#d9f0c6', '#c6e8f0',
    '#d9c6f0', '#f0e0c6', '#c6f0d9', '#f0c6e0', '#c6c6f0',
    '#f5f5dc', '#ffd700', '#ff8c00', '#ff6347', '#32cd32',
    '#00bfff', '#9370db', '#ff69b4', '#a9a9a9', '#000000',
  ];
  _aliasColorMode = true;
  document.getElementById('tag-color-title').textContent = '选择备注名底色';
  const palette = document.getElementById('tag-color-palette');
  palette.innerHTML = '';
  colors.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === aliasBg() ? ' sel' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.onclick = () => {
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('sel'));
      sw.classList.add('sel');
      updateColorPreview();
    };
    palette.appendChild(sw);
  });
  updateColorPreview();
  modalShow(document.getElementById('tag-color-modal'));
}
function updateColorPreview() {
  const p = document.getElementById('tag-color-preview');
  if (!p) return;
  const sel = document.querySelector('#tag-color-palette .color-swatch.sel');
  p.style.background = sel ? sel.dataset.color : aliasBg();
  p.textContent = sel ? sel.dataset.color : '';
}
function saveTagColor() {
  const sel = document.querySelector('#tag-color-palette .color-swatch.sel');
  // 方案颜色（筛选方案调色板，schemeColorTarget >= 0 时）
  if (typeof schemeColorTarget !== 'undefined' && schemeColorTarget >= 0) {
    if (sel) {
      if (typeof loadSchemes === 'function') {
        const list = loadSchemes();
        if (list[schemeColorTarget]) {
          list[schemeColorTarget].color = sel.dataset.color || selColor;
          saveSchemes(list);
        }
      }
      if (typeof renderSchemes === 'function') renderSchemes();
    }
    schemeColorTarget = -1;
    modalHide(document.getElementById('tag-color-modal'));
    return;
  }
  if (_aliasColorMode) {
    if (sel) setAliasBg(sel.dataset.color);
    _aliasColorMode = false;
    modalHide(document.getElementById('tag-color-modal'));
    updateAliasColorPreview();
    if (typeof refresh === 'function') refresh();
    return;
  }
  if (tagCtxItem) {
    selColor = sel ? sel.dataset.color : selColor;
    fetch('/api/tags/' + tagCtxItem.id + '/color', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({color: selColor})}).then(() => {
      loadTags(); refresh();
    });
    modalHide(document.getElementById('tag-color-modal'));
  }
}
function updateAliasColorPreview() {
  const sw = document.getElementById('alias-color-preview');
  if (sw) sw.style.background = aliasBg();
}
async function clearAllAliases() {
  if (!confirm('确定要清除所有备注名吗？\n\n此操作将删除所有文件/文件夹的备注名，且不可恢复。\n\n（真实文件名不受影响）')) return;
  try {
    const r = await fetch('/api/alias/clear-all', {method: 'POST'});
    const d = await r.json();
    if (!d.ok) { alert('清除失败: ' + (d.error || '')); return; }
    alert('已清除所有备注名');
    if (typeof refresh === 'function') refresh();
  } catch (e) { alert('清除失败: ' + e.message); }
}
window.closeTagColor = function () {
  _aliasColorMode = false;
  modalHide(document.getElementById('tag-color-modal'));
};
