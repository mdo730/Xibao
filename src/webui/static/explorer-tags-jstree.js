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
      const newName = (data.text || '').trim();
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
      // 记录原位置（用于用户取消时回滚）
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
        if (d.orphans && d.orphans.length) {
          const names = d.orphans.slice(0, 5).map(o => '· ' + o.path.split('/').pop() + ' → ' + o.tag).join('\n');
          const more = d.orphans.length > 5 ? '\n…等 ' + d.orphans.length + ' 个' : '';
          const ok = confirm('⚠️ 本次移动产生了 ' + d.orphans.length + ' 个「孤儿挂载」：\n\n' +
            names + more + '\n\n这些文件挂了父级标签，但移动后无法在编辑标签里取消。\n\n' +
            '确定继续？（会自动移入「标签异常」警示区）\n取消则撤回本次拖动。');
          if (!ok) {
            rollback();
            return;
          }
        }
        // 无论是否产生孤儿，移动成功都刷新标签树统计（含祖先链同步后的计数）
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
    tree.settings.core.data = tagsToJsTree(0);
    tree.settings.core.multiple = _filterMode;
    tree.refresh();
    // refresh 完成后重新上色
    setTimeout(() => styleTagColorDots(), 0);
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
  currentTagIds = []; currentPath = ''; refresh(); updateTagActive(); renderFilterChips();
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

// ---- 活动筛选 chips 条（仅筛选模式显示；位置与尺寸可在设置切换） ----
const CHIPS_POS_KEY = 'xibao_chips_pos';   // 'tree'(标签树顶) | 'top'(地址栏下)
const CHIPS_SIZE_KEY = 'xibao_chips_size'; // 'sm' | 'md' | 'lg'
function chipsPos() { return localStorage.getItem(CHIPS_POS_KEY) === 'top' ? 'top' : 'tree'; }
function chipsSize() { const s = localStorage.getItem(CHIPS_SIZE_KEY); return ['sm', 'md', 'lg'].includes(s) ? s : 'md'; }
function chipsContainers() {
  return [document.getElementById('tag-filter-chips'), document.getElementById('tag-filter-chips-top')];
}
function renderFilterChips() {
  const active = _filterMode && currentTagIds.length;
  chipsContainers().forEach(wrap => {
    if (!wrap) return;
    const isTop = wrap.id === 'tag-filter-chips-top';
    const showHere = active && (chipsPos() === 'top') === isTop;
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
function renderTagOptionTree(containerSel, checkedIds, leafOnly) {
  function buildData(parentId) {
    return tagChildren(parentId).map(t => {
      const kids = tagChildren(t.id);
      const node = {
        id: 'tag_' + t.id,
        text: t.name,
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
      whole_node: false,      // 只点勾选框才勾选
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
    const name = (node2.text || '').trim();
    if (status && name && name !== tagName(tagCtxItem.id)) apiRenameTag(tagCtxItem.id, name);
  });
}



