// ---- 键盘导航（Windows 资源管理器风格） ----
function findFocusedIndex() {
  // 基于 lastSelIndex 或 selected 中的第一个
  if (lastSelIndex >= 0 && orderedKeys[lastSelIndex]) return lastSelIndex;
  if (selected.size) {
    const first = selKeys()[0];
    return orderedKeys.indexOf(first);
  }
  return 0;
}
function moveFocus(delta) {
  if (!orderedKeys.length) return;
  let idx = findFocusedIndex();
  if (idx < 0) idx = delta > 0 ? 0 : orderedKeys.length - 1;
  idx = Math.max(0, Math.min(orderedKeys.length - 1, idx + delta));
  const key = orderedKeys[idx];
  const item = _allItems[idx];
  if (!item) return;
  if (!e_shift) {
    selected.clear();
    selected.add(key);
    lastSelIndex = idx;
    updateSelectionUI();
  } else {
    selected.add(key);
    lastSelIndex = idx;
    updateSelectionUI();
  }
  // 滚动到可见
  const el = document.querySelector('.cell[data-key="' + CSS.escape(key) + '"], .list-view tr[data-key="' + CSS.escape(key) + '"]');
  if (el) el.scrollIntoView({block: 'nearest'});
}
let e_shift = false;

// → 进入当前选中的文件夹
function enterSelectedFolder() {
  const k = selected.size ? selKeys()[0] : (orderedKeys[lastSelIndex] || null);
  if (!k) return;
  const it = _allItems.find(x => x.path === k);
  if (it && it.isFolder) onItemDblClick(it.path, true);
}

function handleKey(e) {
  // 输入框内不拦截
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
    if (e.key === 'Escape') hideContextMenus();
    return;
  }
  e_shift = e.shiftKey;

  if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); enterSelectedFolder(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); navUp(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const k = selected.size ? selKeys()[0] : (orderedKeys[lastSelIndex] || null);
    if (!k) return;
    const it = _allItems.find(x => x.path === k);
    if (it) onItemDblClick(it.path, it.isFolder);
  }
  else if (e.key === 'Backspace') { e.preventDefault(); navUp(); }
  else if (e.key === 'Q' || e.key === 'q') {
    e.preventDefault();
    // Q：切换显示模式（文件名 / 备注名）
    toggleDisplayMode();
  }
  else if (e.key === 'R' || e.key === 'r') {
    e.preventDefault();
    // R：设置备注名（仅单选）
    if (selected.size > 1) return;
    const c = (typeof currentCtx === 'function') ? currentCtx() : null;
    if (c) ctxSetAlias();
  }
  else if (e.key === 'F2') {
    e.preventDefault();
    if (selected.size === 1) {
      const k = selKeys()[0];
      ctxItem = {path: k, kind: _allItems.find(x => x.path === k)?.isFolder ? 'folder' : 'file'};
      ctxRename();
    }
  }
  else if (e.key === 'F' || e.key === 'f') {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+F：切换筛选模式
      toggleFilterMode();
    } else if (selected.size || ctxItem) {
      // F：属性（多选=多选属性）
      ctxAttr();
    }
  }
  else if (e.key === 'E' || e.key === 'e') {
    e.preventDefault();
    if (selected.size || ctxItem) {
      // E：编辑标签 / 追加标签
      ctxTag();
    }
  }
  else if (e.key === 'Delete') {
    e.preventDefault();
    if (selected.size) ctxDelete();
  }
  else if (e.key === ' ' && !e.repeat) {
    e.preventDefault();
    const k = selected.size ? selKeys()[0] : (orderedKeys[lastSelIndex] || null);
    if (k) {
      const it = _allItems.find(x => x.path === k);
      if (it && !it.isFolder) toggleQuickLook(it);
    }
  }
  else if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    orderedKeys.forEach(k => selected.add(k));
    updateSelectionUI();
  }
  else if (e.key === 'Escape') {
    hideContextMenus();
    closeQuickLook();
  }
}

document.addEventListener('keydown', handleKey);
