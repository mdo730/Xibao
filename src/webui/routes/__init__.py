"""路由蓝图统一注册。"""
from .tags import tags_bp
from .files import files_bp
from .search import search_bp
from .settings import settings_bp
from .external import external_bp

ALL_BLUEPRINTS = (tags_bp, files_bp, search_bp, settings_bp, external_bp)
