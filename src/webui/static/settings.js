/* 设置弹窗：搜索配置 + 动画开关 + 标签迁移开关 */
function openSettingsModal() {
  modalShow(document.getElementById('settings-modal'));
  setLoadSearch();
  const cb = document.getElementById('set-animations');
  if (cb) cb.checked = localStorage.getItem('xibao_animations') !== '0';
  loadMigrateSetting();
  renderChipsSettingUI();
  updateAliasColorPreview();
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
}
function saveTagColor() {
  const sel = document.querySelector('#tag-color-palette .color-swatch.sel');
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
