import contextlib
import os
import sys
import threading
import time

import uvicorn
from loopback import create_loopback_socket


def parent_process_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def poll_parent_until_exit(pid: int) -> None:
    while parent_process_is_alive(pid):
        time.sleep(2)
    os._exit(0)


def wait_for_windows_parent_handle(pid: int) -> bool:
    import ctypes

    synchronize = 0x00100000
    infinite = 0xFFFFFFFF
    handle = ctypes.windll.kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        return False

    try:
        ctypes.windll.kernel32.WaitForSingleObject(handle, infinite)
        os._exit(0)
    finally:
        ctypes.windll.kernel32.CloseHandle(handle)

    return True


def monitor_parent_process(
    pid: int,
    platform_name: str = sys.platform,
    wait_for_windows_parent=wait_for_windows_parent_handle,
    poll_parent=poll_parent_until_exit,
) -> None:
    if platform_name == "win32" and wait_for_windows_parent(pid):
        return

    poll_parent(pid)


def exit_when_parent_exits() -> None:
    parent_pid = os.environ.get("SAYIT_PARENT_PID")
    if not parent_pid:
        return

    try:
        pid = int(parent_pid)
    except ValueError:
        return

    def monitor_parent() -> None:
        monitor_parent_process(pid)

    threading.Thread(target=monitor_parent, daemon=True).start()


def load_backend_app():
    from app import app

    return app


def announce_backend_url(server_socket) -> None:
    host, port = server_socket.getsockname()
    print(f"http://{host}:{port}", flush=True)


def create_uvicorn_server(app):
    config = uvicorn.Config(app, log_level="warning", access_log=False)
    return uvicorn.Server(config)


def run_backend(
    load_app=load_backend_app,
    socket_factory=create_loopback_socket,
    server_factory=create_uvicorn_server,
) -> None:
    exit_when_parent_exits()
    server_socket = socket_factory()
    announce_backend_url(server_socket)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            app = load_app()
        server = server_factory(app)
        server.run(sockets=[server_socket])
    finally:
        with contextlib.suppress(Exception):
            server_socket.close()


def main() -> None:
    run_backend()


if __name__ == "__main__":
    main()
