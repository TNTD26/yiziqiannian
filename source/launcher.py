# -*- coding: utf-8 -*-
"""
一字千年 · AI 甲骨文数字生命馆  |  桌面应用启动器
版本：V1.0

本程序是桌面应用的主进程，职责限定为三件事：
  1) 在 127.0.0.1 的空闲端口启动一个仅供本软件使用的本地静态服务；
  2) 以「独立应用窗口」方式打开软件界面 —— 无地址栏、无标签栏、无状态栏、
     无任何启动状态文字，界面由 Chromium 原生 DPI 渲染；
  3) 通过页面心跳与 pagehide 通知感知窗口关闭，随即停止服务并结束进程。

软件主体（全部业务功能：AI 识别、字形库、文字演化、造字实验室、3D 数字
生命、数字展厅等）由同目录的 HTML / CSS / JavaScript 实现。本启动器只提供
运行容器，不改动、不替代、不注入任何业务逻辑。
"""

import ctypes
import os
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from ctypes import wintypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_NAME = "一字千年 · AI 甲骨文数字生命馆"
VERSION = "V1.0"
ENTRY = "START.html"
ALIAS = "打开作品.html"
MUTEX_NAME = "YiziqianNian_Desktop_V1"
PROFILE_DIRNAME = "YiziqianNian"
HEARTBEAT_TIMEOUT = 45.0   # 页面心跳多久未更新即判定窗口已关闭（兜底）
START_GRACE = 30.0         # 启动宽限期，避免浏览器冷启动被误判
SHUTDOWN_GRACE = 2.5       # 关闭通知后的观察窗口：期间若有新心跳则视为刷新，取消退出

# ---------------------------------------------------------------------------
# 路径：打包后取 exe 所在目录；源码运行时取 source/ 的上一级
# ---------------------------------------------------------------------------
if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STATE = {"beat": time.time(), "stop": threading.Event(), "closing": None}

# 注入到界面页末尾的桌面桥接脚本：只做心跳与关闭通知，不触碰任何业务功能。
# 采用运行时注入而非修改 START.html，保证网页入口在浏览器直接打开时零副作用。
BRIDGE_JS = """<script>
(function () {
  function ping() {
    try {
      fetch('/__heartbeat?t=' + Date.now(), { cache: 'no-store', keepalive: true })
        .catch(function () {});
    } catch (e) {}
  }
  ping();
  var timer = setInterval(ping, 2000);
  var sent = false;
  function bye() {
    if (sent) return;
    sent = true;
    try { clearInterval(timer); } catch (e) {}
    try { navigator.sendBeacon('/__shutdown', 'bye'); } catch (e) {}
  }
  window.addEventListener('pagehide', bye);
  window.addEventListener('beforeunload', bye);
})();
</script>
"""


class AppHandler(SimpleHTTPRequestHandler):
    """静态资源服务 + 三个内部通信端点。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def log_message(self, fmt, *args):
        # 静默运行：不产生控制台输出，也不写日志文件
        return

    def _reply(self, body, ctype="text/plain; charset=utf-8", code=200):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def _serve_entry(self, filename):
        fp = os.path.join(APP_DIR, filename)
        try:
            with open(fp, "r", encoding="utf-8-sig") as f:
                html = f.read()
        except OSError:
            self.send_error(404, "Entry not found")
            return
        if "</body>" in html:
            html = html.replace("</body>", BRIDGE_JS + "</body>", 1)
        else:
            html += BRIDGE_JS
        self._reply(html, "text/html; charset=utf-8")

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/__heartbeat":
            STATE["beat"] = time.time()
            self._reply("ok")
            return
        if path == "/__shutdown":
            STATE["closing"] = time.time()
            self._reply("bye")
            return
        if path in ("/", "/index.html"):
            # 兼容 Service Worker 的导航回落：统一导向真实入口
            self.send_response(302)
            self.send_header("Location", "/" + ENTRY)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path in ("/" + ENTRY, "/" + ALIAS):
            self._serve_entry(ENTRY if path == "/" + ENTRY else ALIAS)
            return
        super().do_GET()

    def do_POST(self):
        # sendBeacon 走 POST；读掉请求体以保证连接可正确复用
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            if n > 0:
                self.rfile.read(n)
        except (ValueError, OSError):
            pass
        if self.path.split("?", 1)[0] == "/__shutdown":
            STATE["closing"] = time.time()
            self._reply("bye")
            return
        self.send_error(405)


def find_browser():
    """优先 Microsoft Edge（Windows 10/11 自带），其次 Google Chrome。"""
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pfx = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    la = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        os.path.join(pfx, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pfx, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(la, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(la, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    for name in ("msedge", "chrome", "msedge.exe", "chrome.exe"):
        p = shutil.which(name)
        if p:
            return p
    return None


def profile_dir():
    """持久化浏览器用户目录：保证「数字展厅」收藏跨次启动不丢失。"""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA") or APP_DIR
    d = os.path.join(base, PROFILE_DIRNAME, "UserProfile")
    os.makedirs(d, exist_ok=True)
    return d


def launch_browser(exe, url, profile):
    args = [
        exe,
        "--app=" + url,
        "--user-data-dir=" + profile,
        "--no-first-run",
        "--no-default-browser-check",
        # 关闭后台节流：窗口最小化时心跳与 3D 动画仍按正常频率运行
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-mode",
        # 允许 Chromium 按系统 DPI 原生渲染，避免宿主位图缩放造成的文字发虚
        "--high-dpi-support=1",
        "--window-size=1600,940",
        "--window-position=80,40",
    ]
    # 浏览器属于 GUI 子系统：不要设置 STARTF_USESHOWWINDOW —— 其 wShowWindow
    # 默认值为 0(SW_HIDE)，会把应用窗口隐藏；也不要 CREATE_NO_WINDOW。
    # 启动器本身以 --noconsole 运行，子进程不会额外产生控制台窗口。
    # 注意：不加 --disable-gpu，3D 数字生命依赖 WebGL2
    return subprocess.Popen(args)


def message_box(text, title=APP_NAME, flags=0x10):
    try:
        ctypes.windll.user32.MessageBoxW(None, text, title, flags)
    except Exception:
        pass


def already_running():
    """进程互斥：避免重复双击产生多个服务与多个窗口。"""
    try:
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, ctypes.c_wchar_p]
        k32.CreateMutexW.restype = ctypes.c_void_p
        k32.CreateMutexW(None, True, MUTEX_NAME)
        return ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS
    except Exception:
        return False


def main():
    if already_running():
        message_box("「%s」已经在运行中，请查看已打开的窗口。" % APP_NAME,
                    APP_NAME, 0x40)
        return 0

    if not os.path.isfile(os.path.join(APP_DIR, ENTRY)):
        message_box(
            "未找到软件界面文件 START.html。\n\n"
            "请确认本程序与 assets、docs 等目录位于同一文件夹，"
            "并已从压缩包完整解压后再运行。",
            APP_NAME, 0x10)
        return 1

    try:
        server = ThreadingHTTPServer(("127.0.0.1", 0), AppHandler)
    except OSError as e:
        message_box("本地服务启动失败：%s" % e, APP_NAME, 0x10)
        return 1

    port = server.server_address[1]
    url = "http://127.0.0.1:%d/%s" % (port, ENTRY)
    threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.2},
        daemon=True,
    ).start()

    proc = None
    browser = find_browser()
    if browser:
        try:
            proc = launch_browser(browser, url, profile_dir())
        except Exception:
            proc = None
    if proc is None:
        # 兜底：系统默认浏览器。心跳仍由注入脚本提供，退出检测照常生效。
        try:
            webbrowser.open(url)
        except Exception:
            pass

    STATE["beat"] = time.time()
    started = time.time()
    try:
        while not STATE["stop"].is_set():
            time.sleep(0.3)
            now = time.time()
            closing = STATE["closing"]
            if closing is not None:
                # 关闭通知后的观察窗口内又收到心跳 → 属于刷新 / 重新打开，取消退出
                if STATE["beat"] > closing:
                    STATE["closing"] = None
                    continue
                if now - closing > SHUTDOWN_GRACE:
                    break
            if now - started > START_GRACE and now - STATE["beat"] > HEARTBEAT_TIMEOUT:
                break
    finally:
        # 关闭顺序：先停服务并释放端口，再让浏览器进程自然收尾
        try:
            server.shutdown()
            server.server_close()
        except Exception:
            pass
        if proc is not None and proc.poll() is None:
            try:
                proc.wait(timeout=1.2)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
