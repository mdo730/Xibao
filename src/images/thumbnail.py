"""视频/文件缩略图：用 PyAV（FFmpeg 库绑定）提取视频帧。

进程内解码，无需外部 ffmpeg，全格式覆盖（MP4/MKV/HEVC 等）。
代价：依赖 av 包（安装体积约 66MB），打包时用 pyinstaller-hooks-contrib 自动收集。

缓存：%LOCALAPPDATA%\\Xibao\\thumbnails\\<md5>_<size>.jpg
失效：按源文件 mtime+size 判断（维护旁车 .meta）。
"""
import hashlib
import io
import os
import threading

from PIL import Image

from ..common import log

_THUMB_DIR = None


def thumb_dir():
    global _THUMB_DIR
    if _THUMB_DIR is None:
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
        _THUMB_DIR = os.path.join(base, "Xibao", "thumbnails")
    return _THUMB_DIR


def _cache_key(path, size):
    digest = hashlib.md5(("file://" + os.path.abspath(path)).encode("utf-8")).hexdigest()
    return f"{digest}_{size}.jpg"


def _meta_key(path, size):
    return _cache_key(path, size).replace(".jpg", ".meta")


def _fail_key(path, size):
    return _cache_key(path, size).replace(".jpg", ".fail")


def _cache_hit(path, size):
    thumb = os.path.join(thumb_dir(), _cache_key(path, size))
    meta = os.path.join(thumb_dir(), _meta_key(path, size))
    if not os.path.exists(thumb) or not os.path.exists(meta):
        return None
    try:
        st = os.stat(path)
        with open(meta, "r", encoding="utf-8") as f:
            mtime_ns, fsize = f.read().split("|")
        if int(mtime_ns) == st.st_mtime_ns and int(fsize) == st.st_size:
            return thumb
    except Exception:
        pass
    return None


def _extract_frame(path, size):
    """PyAV 取约 20% 时长的帧，返回缩放到 size 的 JPEG bytes。"""
    import av
    with av.open(path) as container:
        stream = next((s for s in container.streams if s.type == "video"), None)
        if stream is None:
            raise RuntimeError("no video stream")
        # 目标时间：约 20% 时长（避免片头黑场）
        if container.duration:
            target_ts = int(container.duration * 0.2)
        else:
            target_ts = 0
        container.seek(target_ts, stream=stream)
        frame = None
        for f in container.decode(video=0):
            frame = f
            break
        if frame is None:
            raise RuntimeError("no frame decoded")
        img = frame.to_image()
        img.thumbnail((size, size), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=82)
        return out.getvalue()


def _extract_frame_av(path, size):
    """PyAV 提取帧（回退后端）。"""
    return _extract_frame(path, size)


def get_video_thumb(path, size=256, sync=False):
    """获取缩略图，多后端：系统 COM 优先，PyAV 回退。
    sync=True 时阻塞生成（后台池用）；sync=False 只查缓存，未命中返回 (False, None) 由调用方排队。
    命中缓存返回 (True, thumb_path)；生成失败返回 (False, None)。"""
    if not os.path.isfile(path):
        return False, None
    cached = _cache_hit(path, size)
    if cached:
        return True, cached
    if not sync:
        return False, None
    os.makedirs(thumb_dir(), exist_ok=True)
    data = None
    # 后端1：系统 COM 缩略图（覆盖广、与资源管理器一致）
    try:
        from ..images import shell_thumbnail
        img = shell_thumbnail.get_shell_thumbnail(path, size)
        if img is not None:
            out = io.BytesIO()
            img.convert("RGB").save(out, format="JPEG", quality=82)
            data = out.getvalue()
    except Exception as e:
        log.warning("COM 缩略图失败 %s: %s", path, e)
    # 后端2：PyAV 回退（仅当 COM 无结果）
    if data is None:
        try:
            data = _extract_frame_av(path, size)
        except Exception as e:
            log.warning("PyAV 缩略图失败 %s: %s", path, e)
    if data is None:
        _write_fail(path, size)
        return False, None
    try:
        thumb_path = os.path.join(thumb_dir(), _cache_key(path, size))
        tmp = thumb_path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, thumb_path)
        st = os.stat(path)
        with open(os.path.join(thumb_dir(), _meta_key(path, size)), "w", encoding="utf-8") as f:
            f.write(f"{st.st_mtime_ns}|{st.st_size}")
        return True, thumb_path
    except Exception as e:
        log.warning("视频缩略图生成失败 %s: %s", path, e)
        _write_fail(path, size)
        return False, None


def get_image_thumb(path, size=256):
    """图片缩略图：PIL 直接降采样（比 COM/解码快，纯图片专用）。
    命中缓存返回 (True, thumb_path)；失败返回 (False, None)。"""
    if not os.path.isfile(path):
        return False, None
    cached = _cache_hit(path, size)
    if cached:
        return True, cached
    try:
        with Image.open(path) as im:
            im.thumbnail((size, size), Image.LANCZOS)
            out = io.BytesIO()
            im.convert("RGB").save(out, format="JPEG", quality=82)
            data = out.getvalue()
    except Exception as e:
        log.warning("图片缩略图失败 %s: %s", path, e)
        _write_fail(path, size)
        return False, None
    try:
        os.makedirs(thumb_dir(), exist_ok=True)
        thumb_path = os.path.join(thumb_dir(), _cache_key(path, size))
        tmp = thumb_path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, thumb_path)
        st = os.stat(path)
        with open(os.path.join(thumb_dir(), _meta_key(path, size)), "w", encoding="utf-8") as f:
            f.write(f"{st.st_mtime_ns}|{st.st_size}")
        return True, thumb_path
    except Exception as e:
        log.warning("图片缩略图保存失败 %s: %s", path, e)
        _write_fail(path, size)
        return False, None


def _write_fail(path, size):
    try:
        st = os.stat(path)
        p = os.path.join(thumb_dir(), _fail_key(path, size))
        with open(p, "w", encoding="utf-8") as f:
            f.write(f"{st.st_mtime_ns}|{st.st_size}")
    except Exception:
        pass


def is_failed(path, size):
    p = os.path.join(thumb_dir(), _fail_key(path, size))
    if not os.path.exists(p):
        return False
    try:
        st = os.stat(path)
        with open(p, "r", encoding="utf-8") as f:
            mtime_ns, fsize = f.read().split("|")
        return int(mtime_ns) == st.st_mtime_ns and int(fsize) == st.st_size
    except Exception:
        return False


# ---- 后台生成队列（防列表卡顿） ----

class _ThumbPool:
    """单线程后台生成，避免并发解码压力。"""
    def __init__(self):
        self._thread = None
        self._queue = []
        self._cond = threading.Condition()

    def submit(self, path, size):
        with self._cond:
            self._queue.append((path, size))
            self._cond.notify()
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def _run(self):
        while True:
            with self._cond:
                while not self._queue:
                    self._cond.wait(timeout=60)
                if not self._queue:
                    return
                path, size = self._queue.pop(0)
            try:
                get_video_thumb(path, size, sync=True)
            except Exception:
                pass


_pool = _ThumbPool()


def request_thumb(path, size=256):
    """请求后台生成缩略图（不阻塞调用方）。"""
    _pool.submit(path, size)
