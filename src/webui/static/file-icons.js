/* 文件图标：基于 material-icon-theme 映射表 */
let _iconMap = null;

function ensureIconMap() {
  if (_iconMap) return Promise.resolve(_iconMap);
  return fetch('/static/file-icons-map.json').then(r => r.json()).then(d => { _iconMap = d; return d; });
}

// 文件名 → 图标名；未命中返回 null
function iconNameForFile(name) {
  if (!_iconMap) return null;
  // 文件名精确匹配优先
  if (_iconMap.fileNames && _iconMap.fileNames[name]) return _iconMap.fileNames[name];
  // 扩展名匹配（取最后一个点后面的部分，支持 .html 等）
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    if (_iconMap.fileExtensions && _iconMap.fileExtensions[ext]) return _iconMap.fileExtensions[ext];
  }
  return null;
}

function iconSvgUrl(name) {
  return '/static/icons/' + name + '.svg';
}

// 返回内联 <img> 或 fallback span 的 HTML
function fileIconHtml(name, cls, fallbackCls, emoji, path) {
  const iconName = iconNameForFile(name);
  if (iconName) {
    return `<img class="${cls}" src="${iconSvgUrl(iconName)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${fallbackCls}',textContent:'${emoji}'}))">`;
  }
  // 无 SVG 映射：尝试系统文件图标（.exe 游戏/3D等），失败回退 emoji
  if (path) {
    return `<img class="${cls}" src="/api/fileicon?path=${encodeURIComponent(path)}&size=64" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${fallbackCls}',textContent:'${emoji}'}))">`;
  }
  return `<span class="${fallbackCls}">${emoji}</span>`;
}
