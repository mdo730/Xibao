// ---- 标签树：jsTree 版（折叠/行内编辑/拖拽） ----
// 覆盖 explorer-tree.js 中的手写渲染函数

let _filterMode = false;  // false=正常模式（单击单标签筛选），true=筛选模式（toggle 多选）

function tagChildren(parentId) { return allTags.filter(t => (t.parent_id || 0) === (parentId || 0)); }
function tagName(tid) { const t = allTags.find(x => x.id === tid); return t ? t.name : ''; }

function tagsToJsTree(parentId) {
  return tagChildren(parentId).map(t => ({
    id: 'tag_' + t.id,
    text: (t.count != null && t.count > 0) ? `${t.name} (${t.count})` : t.name,
    li_attr: {'data-tag-id': t.id},
    icon: t.color ? 'jstree-color' : false,
    state: {opened: !collapsedTags.has(t.id), selected: currentTagIds.includes(t.id)},
    children: tagChildren(t.id).length ? tagsToJsTree(t.id) : [],
    a_attr: t.pending ? {title: '待审核标签：接受前不计入计数', 'data-pending': '1'} : {},
  }));
}

// 标签树渲染后给待审核标签加视觉标记
function stylePendingTags() {
  if (!$) return;
  $('#tag-tree .jstree-anchor').each(function () {
    const a = $(this);
    const node = $('#tag-tree').jstree(true).get_node(a.closest('li'));
    if (!node || !node.a_attr || node.a_attr['data-pending'] !== '1') return;
    if (a.find('.jstree-pending-tag').length) return;
    a.append('<span class="jstree-pending-tag">⏳</span>');
  });
}

function renderTagTree() {
  if (!$) return;  // jQuery 未加载则退回
  const roots = tagChildren(0);
  if (!$('#tag-tree').data('jstree')) {
    $('#tag-tree').jstree({
      core: {
        data: tagsToJsTree(0),
        check_callback: true,
        dblclick_toggle: false,   // 关闭双击切换开合，改用双击重命名
        themes: {name: 'default', dots: true, icons: false},
        multiple: _filterMode,    // 正常=单选高亮；筛选模式=多选
      },
      plugins: ['contextmenu', 'dnd', 'rename', 'types'],
      contextmenu: {
        items: function (node) {
          const tid = parseInt(node.li_attr['data-tag-id'] || node.id.replace('tag_', ''));
          tagCtxItem = allTags.find(x => x.id === tid) || {id: tid};
          return {
            addChild: {label: '新建子标签…', action: function () { tagAddChild(); }},
            rename: {label: '重命名…', action: function () { tagRename(); }},
            color: {label: '设置颜色…', action: function () { openTagColor(); }},
            del: {label: '删除', action: function () { tagDelete(); }},
          };
        },
      },
      types: {
        default: {icon: false},
      },
    }).on('select_node.jstree', function (e, data) {
      if (_suppressSelect) return;
      const tid = parseInt(data.node.li_attr['data-tag-id']);
      if (!tid) return;
      if (_filterMode) {
        // 筛选模式：toggle 加入/移出
        filterTag(tid);
      } else {
        // 正常模式：单标签筛选（替换）
        selectTag(tid);
      }
    }).on('rename_node.jstree', function (e, data) {
      const tid = parseInt(data.node.li_attr['data-tag-id']);
      // 编辑框预填的是带计数的文本（如"壁纸 (3)"），提交时剥离计数后缀避免写进真名
      let newName = (data.text || '').trim().replace(/\s*\(\d+\)\s*$/, '');
      if (tid && newName) apiRenameTag(tid, newName);
    }).on('move_node.jstree', function (e, data) {
      // 拖动标签调整位置/父级 → 持久化到后端
      const tid = parseInt(data.node.li_attr['data-tag-id']);
      if (!tid) return;
      const parent = data.parent && data.parent !== '#' ? data.parent : null;
      let newParentId = 0;
      if (parent) {
        const pid = parent.indexOf('tag_') === 0 ? parseInt(parent.replace('tag_', '')) : NaN;
        if (isNaN(pid)) return;  // 目标不是有效标签节点
        newParentId = pid;
      }
      let position = 0;
      try {
        const inst = data.instance;
        const parentNode = parent ? inst.get_node(parent) : inst.get_node('#');
        const idx = (parentNode.children || []).indexOf(data.node.id);
        position = idx >= 0 ? idx : 0;
      } catch (e) { position = data.position || 0; }
      // 记录原位置（供用户取消时回滚）
      const oldParent = data.old_parent && data.old_parent !== '#' ? data.old_parent : null;
      let oldParentId = 0;
      if (oldParent) {
        const op = oldParent.indexOf('tag_') === 0 ? parseInt(oldParent.replace('tag_', '')) : NaN;
        oldParentId = isNaN(op) ? 0 : op;
      }
      let oldPosition = data.old_position || 0;

      function persist() {
        return fetch('/api/tags/' + tid + '/move', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({parent_id: newParentId, order: position}),
        }).then(r => r.json()).catch(() => ({ok: false, error: '网络错误'}));
      }
      function rollback() {
        // 撤回：移回原父级原位置
        return fetch('/api/tags/' + tid + '/move', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({parent_id: oldParentId, order: oldPosition}),
        }).catch(() => {}).then(() => loadTags());
      }

      persist().then(d => {
        if (!d.ok) {
          alert('移动失败: ' + (d.error || ''));
          loadTags();
          return;
        }
        // 移动可能使某些文件上的标签"无法管理"（新父级变父级，编辑弹窗禁用）→ 预警
        if (d.affected && d.affected.length) {
          const names = d.affected.slice(0, 5).map(o => '· ' + o.path.split('/').pop() + ' → ' + o.tag).join('\n');
          const more = d.affected.length > 5 ? '\n…等 ' + d.affected.length + ' 个' : '';
          const ok = confirm('⚠️ 本次移动使 ' + d.affected.length + ' 个文件上的标签「无法管理」：\n\n' +
            names + more + '\n\n这些文件直接挂了该标签，但它现在是父级，编辑弹窗里无法勾选/取消。\n\n' +
            '确定继续？（会显示在「⚠️ 标签异常」中）\n取消则撤回本次拖动。');
          if (!ok) {
            rollback();
            return;
          }
        }
        // 移动成功刷新标签树（计数已由后端 CTE 重算）
        loadTags();
      });
    }).on('ready.jstree', function () {
      styleTagColorDots();
      stylePendingTags();
    }).on('refresh.jstree after_open.jstree', function () {
      setTimeout(() => { styleTagColorDots(); stylePendingTags(); }, 0);
    });
    // 双击重命名（现代交互）
    $('#tag-tree').on('dblclick.jstree', '.jstree-anchor', function (e) {
      if (e.target.tagName.toLowerCase() === 'input') return;
      const inst = $('#tag-tree').jstree(true);
      const node = inst.get_node(this);
      if (!node) return;
      const tid = parseInt(node.li_attr['data-tag-id']);
      if (!tid) return;
      tagCtxItem = allTags.find(x => x.id === tid) || {id: tid};
      setTimeout(() => tagRename(), 10);
    });
  } else {
    const tree = $('#tag-tree').jstree(true);
    tree.settings.core.multiple = _filterMode;
    // 增量刷新：只更新计数文本，不整树 refresh()（保留展开/选中状态）
    updateTagCounts(tree);
    // set_text 会重建受影响节点 DOM，重扫颜色圆点补回
    setTimeout(() => { styleTagColorDots(); stylePendingTags(); }, 0);
    // 结构变化（新建/删除/改名）才走全量重建，由 loadTags 单独触发
  }
}

// 轻量更新标签树计数：遍历所有节点，只 set_text 计数有变化的（保留展开/选中状态）
function updateTagCounts(tree) {
  if (!tree) return;
  let needRebuild = false;
  // 预建 tag_id -> tag 映射，避免 O(N²) 的 allTags.find
  const tagById = new Map(allTags.map(t => [t.id, t]));
  tree.get_json('#', {flat: true}).forEach(node => {
    if (!node || !node.li_attr || !node.li_attr['data-tag-id']) return;
    const id = node.id;
    const tid = parseInt(node.li_attr['data-tag-id']);
    const t = tagById.get(tid);
    if (!t) { needRebuild = true; return; }
    const label = (t.count != null && t.count > 0) ? `${t.name} (${t.count})` : t.name;
    if (tree.get_text(id) !== label) tree.set_text(id, label);
  });
  // 节点增删（新建/删除标签）时回退全量重建
  // 注：jsTree 3.x 无 get_ids()，用 get_json 提取（v0.6.2 修复，此前 TypeError 导致重建失效）
  const treeIds = new Set(tree.get_json('#', {flat: true}).map(n => n.id));
  const wantIds = new Set(allTags.map(t => 'tag_' + t.id));
  if (needRebuild || treeIds.size !== wantIds.size) {
    tree.settings.core.data = tagsToJsTree(0);
    tree.refresh();
  }
}

// 颜色图标（用内联色点代替 jsTree 默认图标）
function styleTagColorDots() {
  $('#tag-tree .jstree-node').each(function () {
    const el = $(this);
    const node = $('#tag-tree').jstree(true).get_node(el.attr('id'));
    if (!node) return;
    const tid = parseInt(node.li_attr && node.li_attr['data-tag-id']);
    const t = allTags.find(x => x.id === tid);
    const a = el.find('> .jstree-anchor');
    if (t && t.color && a.find('.tag-color-dot').length === 0) {
      a.prepend(`<span class="tag-color-dot" style="background:${t.color}"></span>`);
    }
  });
}

function updateTagActive() {
  const tree = $('#tag-tree').data('jstree');
  if (!tree) return;
  _suppressSelect = true;
  try {
    tree.deselect_all(true);
    currentTagIds.forEach(tid => {
      const node = tree.get_node('tag_' + tid);
      if (node) tree.select_node(node, true, true);
    });
  } finally {
    _suppressSelect = false;
  }
}
let _suppressSelect = false;

function selectTag(tagId) {
  // 正常模式：单标签筛选（替换）
  currentTagIds = [tagId];
  currentPath = '';
  browseOffset = 0; browseType = 'all';
  navToTag(currentTagIds);
  refresh(); updateTagActive(); renderFilterChips();
}
// 筛选模式：toggle 加入/移出。加入时清理同链冲突（保留更深），避免"父+子"冗余
function filterTag(tagId) {
  if (currentTagIds.includes(tagId)) {
    currentTagIds = currentTagIds.filter(x => x !== tagId);
  } else {
    const t = allTags.find(x => x.id === tagId);
    // 若 T 是已选某标签的祖先（T 覆盖它）→ 移除那个后代
    if (t) currentTagIds = currentTagIds.filter(id => !isAncestorOf(tagId, id));
    // 若已选某标签是 T 的祖先（被 T 精确覆盖）→ 移除那个祖先
    if (t) currentTagIds = currentTagIds.filter(id => !isAncestorOf(id, tagId));
    currentTagIds = [...currentTagIds, tagId];
  }
  currentPath = '';
  browseOffset = 0; browseType = 'all';
  navToTag(currentTagIds);
  refresh(); updateTagActive(); renderFilterChips();
}
// 判断 a 是否为 b 的祖先（沿父链向上找）
function isAncestorOf(a, b) {
  if (a === b) return false;
  let cur = b;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const t = allTags.find(x => x.id === cur);
    if (!t) return false;
    cur = t.parent_id || 0;
    if (cur === a) return true;
  }
  return false;
}
function clearTagFilter() {
  currentTagIds = []; currentPath = ''; browseOffset = 0; browseType = 'all';
  navToTag([]); refresh(); updateTagActive(); renderFilterChips();
}

// 书签按钮：切换筛选模式
function toggleFilterMode() {
  _filterMode = !_filterMode;
  const btn = document.getElementById('btn-filter-mode');
  if (btn) btn.classList.toggle('active', _filterMode);
  // 模式按钮 + 方案按钮按筛选模式显隐
  const showMode = _filterMode ? '' : 'none';
  ['btn-mode-else', 'btn-mode-and', 'btn-schemes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = showMode;
  });
  // 切换模式时刷新树（多选/单选）
  const tree = $('#tag-tree').data('jstree');
  if (tree) {
    tree.settings.core.multiple = _filterMode;
    tree.refresh();
  }
  if (!_filterMode) {
    // 退出筛选模式：清空多选筛选集合
    if (currentTagIds.length > 1) clearTagFilter();
  }
  renderFilterChips();
}

// and/else 模式切换（默认 else=交集）
let _filterRule = 'else';
function setFilterMode(rule) {
  _filterRule = (rule === 'and') ? 'and' : 'else';
  const el = document.getElementById('btn-mode-else');
  const ea = document.getElementById('btn-mode-and');
  if (el) el.classList.toggle('active', _filterRule === 'else');
  if (ea) ea.classList.toggle('active', _filterRule === 'and');
  currentPath = '';
  refresh();
  renderFilterChips();
}
(function initFilterRule() {
  const el = document.getElementById('btn-mode-else');
  if (el) el.classList.add('active');
})();

// ---- 活动筛选 chips 条（仅筛选模式显示；尺寸可在设置切换） ----
const CHIPS_POS_KEY = 'xibao_chips_pos';   // 位置固定为标签树顶（v0.6.1 移除地址栏下方方案）
const CHIPS_SIZE_KEY = 'xibao_chips_size'; // 'sm' | 'md' | 'lg'
function chipsPos() { return 'tree'; }
function chipsSize() { const s = localStorage.getItem(CHIPS_SIZE_KEY); return ['sm', 'md', 'lg'].includes(s) ? s : 'md'; }
function chipsContainers() {
  return [document.getElementById('tag-filter-chips')];
}
function renderFilterChips() {
  const active = _filterMode && currentTagIds.length;
  chipsContainers().forEach(wrap => {
    if (!wrap) return;
    const showHere = active;
    if (!showHere) {
      wrap.innerHTML = '';
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
    // 应用尺寸档
    wrap.dataset.size = chipsSize();
    wrap.innerHTML = '';
    currentTagIds.forEach(tid => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.dataset.tid = String(tid);
      // 有自定义颜色则用标签色，否则保持默认蓝
      const t = allTags.find(x => x.id === tid);
      if (t && t.color) chip.style.background = t.color;
      chip.innerHTML = `<span>${tagName(tid)}</span><span class="tag-chip-x">×</span>`;
      wrap.appendChild(chip);
    });
    // 一键清除全部
    const clear = document.createElement('span');
    clear.className = 'tag-chip-clear';
    clear.textContent = '清空';
    clear.onclick = () => clearTagFilter();
    wrap.appendChild(clear);
  });
}
// 事件委托处理 chips 的 ×（重渲染后仍有效）
(function initChipEvents() {
  document.addEventListener('click', e => {
    const x = e.target.closest('.tag-chip-x');
    if (!x) return;
    e.stopPropagation();
    const tid = parseInt(x.closest('.tag-chip').dataset.tid);
    if (isNaN(tid)) return;
    // 从 currentTagIds 移除（按值过滤，最后一个也能删）
    currentTagIds = currentTagIds.filter(v => v !== tid);
    // 同步 jsTree 高亮
    const tree = $('#tag-tree').data('jstree');
    if (tree) {
      _suppressSelect = true;
      tree.deselect_node('tag_' + tid);
      _suppressSelect = false;
    }
    currentPath = '';
    browseOffset = 0;
    refresh(); renderFilterChips();
  });
})();

function expandAllTags() {
  const tree = $('#tag-tree').data('jstree');
  if (tree) tree.open_all();
  collapsedTags.clear();
}
function collapseAllTags() {
  const tree = $('#tag-tree').data('jstree');
  if (tree) tree.close_all();
  allTags.forEach(t => collapsedTags.add(t.id));
}
// 单切换按钮：展开/折叠全部
function toggleAllTags() {
  const tree = $('#tag-tree').data('jstree');
  if (!tree) return;
  if (tree.get_node('#', true).find('.jstree-open').length > 0) collapseAllTags();
  else expandAllTags();
}
// 打标签弹窗展开/折叠
function toggleTagModalExpand() {
  const tree = $('#tag-modal-list').data('jstree');
  if (!tree) return;
  const btn = document.getElementById('btn-tag-modal-expand');
  const hasOpen = tree.get_node('#', true).find('.jstree-open').length > 0;
  if (hasOpen) { tree.close_all(); btn.textContent = '展开'; }
  else { tree.open_all(); btn.textContent = '折叠'; }
}

async function apiRenameTag(tid, name) {
  const r = await fetch('/api/tags/' + tid, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name})});
  const d = await r.json();
  if (!d.ok) alert('重命名失败: ' + (d.error || ''));
  loadTags(); refresh();
}

// 打标签弹窗/筛选弹窗复用：用 jsTree 渲染树形选项
// leafOnly=true 时父级标签不可勾选（仅叶子可选），用于编辑标签弹窗
// warnTagIds：异常标签 id 集合，渲染时在这些节点加 ⚠️ 警示（提示"此标签现在是父级，不可勾选"）
function renderTagOptionTree(containerSel, checkedIds, leafOnly, warnTagIds) {
  const warn = new Set(warnTagIds || []);
  function buildData(parentId) {
    return tagChildren(parentId).map(t => {
      const kids = tagChildren(t.id);
      const node = {
        id: 'tag_' + t.id,
        text: warn.has(t.id) ? (t.name + ' ⚠️') : t.name,
        li_attr: {'data-tag-id': t.id},
        state: {},
        children: kids.length ? buildData(t.id) : [],
      };
      if (leafOnly && kids.length) node.state.disabled = true;  // 父级禁用勾选
      return node;
    });
  }
  $(containerSel).jstree('destroy').empty();
  $(containerSel).jstree({
    core: {
      data: buildData(0),
      multiple: true,
      themes: {name: 'default', dots: true},
    },
    plugins: ['checkbox'],
    checkbox: {
      tie_selection: false,   // 勾选与选中彻底分离
      whole_node: true,       // 点整行（含文字）即可切换勾选，符合勾选习惯
      three_state: false,     // 关闭父级级联，杜绝"父级变蓝"
      keep_selected_style: true,
    },
  }).on('ready.jstree', function () {
    // DOM 就绪后再勾选，避免初始化竞态
    const tree = $(containerSel).jstree(true);
    if (tree) {
      if (leafOnly) tree.open_all();   // 编辑标签默认全展开，便于勾选叶子
      (checkedIds || []).forEach(tid => {
        const n = tree.get_node('tag_' + tid);
        if (n) tree.check_node(n);
      });
    }
  });
}

// ---- 行内编辑：新建/重命名（jsTree 自带） ----

function addRootTag() {
  const tree = $('#tag-tree').data('jstree');
  if (!tree) return;
  const parent = tree.get_node('#');
  tree.create_node(parent, {text: '新标签'}, 'last', function (node) {
    tree.edit(node, null, function (node2, status) {
      const name = (node2.text || '').trim();
      if (status && name) apiAddTag(name, 0);
      else tree.delete_node(node2);
    });
  });
  tree.deselect_all(true);
}

function tagAddChild() {
  if (!tagCtxItem) return;
  const tree = $('#tag-tree').data('jstree');
  if (!tree) return;
  const parent = tree.get_node('tag_' + tagCtxItem.id);
  if (!parent) return;
  tree.create_node(parent, {text: '新子标签'}, 'last', function (node) {
    tree.edit(node, null, function (node2, status) {
      const name = (node2.text || '').trim();
      if (status && name) apiAddTag(name, tagCtxItem.id);
      else tree.delete_node(node2);
    });
  });
  tree.open_node(parent);
}

function tagRename() {
  if (!tagCtxItem) return;
  const tree = $('#tag-tree').data('jstree');
  if (!tree) return;
  const node = tree.get_node('tag_' + tagCtxItem.id);
  if (!node) return;
  tree.edit(node, null, function (node2, status) {
    // 提交动作由 rename_node.jstree 事件统一处理（apiRenameTag），此处只负责取消时恢复
    if (!status) {
      // 编辑取消：无操作
    }
  });
}

// ---- 标签树数据加载 / 颜色 / 删除 / 新建（自 explorer-tree.js 归位）----

async function loadTags() {
  const r = await fetch('/api/tags');
  const d = await r.json();
  allTags = d.tags || [];
  renderTagTree();
}

let selColor = '#ecc889';
const PALETTE = [
  '#ecc889', '#f0c6c6', '#f5d9a8', '#d9f0c6', '#c6e8f0',
  '#d9c6f0', '#f0e0c6', '#c6f0d9', '#f0c6e0', '#c6c6f0',
  '#f5f5dc', '#ffd700', '#ff8c00', '#ff6347', '#32cd32',
  '#00bfff', '#9370db', '#ff69b4', '#a9a9a9', '#000000',
];
function openTagColor() {
  if (!tagCtxItem) return;
  selColor = tagCtxItem.color || '#ecc889';
  document.getElementById('tag-color-title').textContent = '设置「' + tagName(tagCtxItem.id) + '」颜色';
  const palette = document.getElementById('tag-color-palette');
  palette.innerHTML = '';
  PALETTE.forEach(c => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (c === selColor ? ' sel' : '');
    sw.style.background = c;
    sw.dataset.color = c;
    sw.onclick = () => {
      selColor = c;
      palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('sel'));
      sw.classList.add('sel');
      updateColorPreview();
    };
    palette.appendChild(sw);
  });
  updateColorPreview();
  modalShow(document.getElementById('tag-color-modal'));
}

function tagDelete() {
  if (!tagCtxItem) return;
  if (!confirm(`删除标签「${tagName(tagCtxItem.id)}」及其子标签？`)) return;
  fetch('/api/tags/' + tagCtxItem.id, {method: 'DELETE'}).then(() => {
    // 若删除的标签在当前筛选集合中，先清筛选
    if (currentTagIds.includes(tagCtxItem.id)) {
      currentTagIds = currentTagIds.filter(x => x !== tagCtxItem.id);
      renderFilterChips();
    }
    loadTags(); refresh();   // 无论是否筛选都刷新标签树
  });
}
async function apiAddTag(name, parentId) {
  const r = await fetch('/api/tags', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, parent_id: parentId})});
  const d = await r.json();
  if (!d.ok) { alert('创建失败: ' + (d.error || '')); return; }
  loadTags();
}



