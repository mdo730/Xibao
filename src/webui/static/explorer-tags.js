// ---- 打标签弹窗 ----
let tagModalMode = 'set';  // 'set'=覆盖编辑（单选），'add'=追加（多选）
async function openTagModal(paths, kind, mode) {
  tagModalPaths = (Array.isArray(paths) ? paths : [paths]).map(p => p.replace(/\/+$/, ''));
  tagModalMode = mode || 'set';
  const isMulti = tagModalPaths.length > 1;
  document.getElementById('tag-modal-title').textContent = isMulti
    ? `为 ${tagModalPaths.length} 个条目追加标签`
    : ('编辑标签：' + tagModalPaths[0].split('/').pop());
  try {
    let tags, curIds;
    if (tagModalMode === 'add') {
      // 追加：初始全空（勾选 = 要新增的标签），不展示现有标签避免误导
      const tagsRes = await fetch('/api/tags');
      tags = (await tagsRes.json()).tags || [];
      curIds = new Set();
    } else {
      const [tagsRes, curRes] = await Promise.all([
        fetch('/api/tags'),
        fetch('/api/folders/' + encPath(tagModalPaths[0]) + '/tags'),
      ]);
      tags = (await tagsRes.json()).tags || [];
      const cur = (await curRes.json()).tags || [];
      curIds = new Set(cur.map(t => t.id));
    }
    allTags = tags;
    const list = document.getElementById('tag-modal-list');
    // 统一用 renderTagOptionTree（内部 destroy 重建 + leafOnly），避免二次编辑走非 leafOnly 分支
    if (!tags.length) list.innerHTML = '<p class="muted">还没有标签，请先在右侧标签树新建标签</p>';
    renderTagOptionTree('#tag-modal-list', Array.from(curIds), true);
  } catch (e) { console.error(e); }
  modalShow(document.getElementById('tag-modal'));
}
async function saveTagModal() {
  let ids = [];
  if ($ && $('#tag-modal-list').data('jstree')) {
    const tree = $('#tag-modal-list').jstree(true);
    const checked = tree.get_checked(true);
    ids = checked.map(n => parseInt(n.li_attr['data-tag-id'])).filter(Boolean);
  } else {
    const checks = document.querySelectorAll('#tag-modal-list input[type=checkbox]:checked');
    ids = Array.from(checks).map(c => parseInt(c.value));
  }
  const paths = tagModalPaths;
  const schemeTarget = (typeof editSchemeTarget !== 'undefined') ? editSchemeTarget : -1;
  const mode = tagModalMode;
  closeTagModal();
  // 若在编辑方案模式，保存到方案
  if (schemeTarget >= 0) {
    if (typeof loadSchemes === 'function') {
      const list = loadSchemes();
      if (list[schemeTarget]) {
        list[schemeTarget].tags = ids;
        saveSchemes(list);
      }
    }
    if (typeof renderSchemes === 'function') renderSchemes();
    return;
  }
  if (!paths || !paths.length) return;
  try {
    for (const p of paths) {
      let finalIds = ids;
      if (mode === 'add') {
        // 追加：现有标签 ∪ 勾选，绝不覆盖（原标签不动）
        const curRes = await fetch('/api/folders/' + encPath(p) + '/tags');
        const cur = (await curRes.json()).tags || [];
        const curIds = new Set(cur.map(t => t.id));
        for (const tid of ids) curIds.add(tid);
        finalIds = Array.from(curIds);
      }
      await fetch('/api/folders/' + encPath(p) + '/tags', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({tag_ids: finalIds})});
    }
  } catch (e) { alert('保存失败: ' + e.message); }
  loadTags(); refresh();
}
function closeTagModal() { modalHide(document.getElementById('tag-modal')); tagModalPaths = []; editSchemeTarget = -1; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTagModal(); });

// ---- 标签导出/导入 ----
async function exportTags() {
  // 通过系统保存对话框选择导出位置
  const r = await fetch('/api/tags/export-to', {method: 'POST'});
  const d = await r.json();
  if (!d.ok) { if (d.error !== '已取消导出') alert('导出失败: ' + (d.error || '')); return; }
  alert('已导出到: ' + d.path);
}
async function importTags() {
  const mode = confirm('导入方式：[确定]=清空替换，[取消]=合并');
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await fetch('/api/tags/import', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data, mode: mode ? 'replace' : 'merge'})});
      const d = await r.json();
      if (!d.ok) { alert('导入失败: ' + (d.error || '')); return; }
      alert(mode ? '已清空替换导入' : '已合并导入');
      loadTags(); refresh();
    } catch (e) { alert('导入失败: ' + e.message); }
  };
  input.click();
}


