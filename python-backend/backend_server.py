import socket
import os
import sys
import threading
import time

import uvicorn


def exit_when_parent_exits() -> None:
    parent_pid = os.environ.get("SAYIT_PARENT_PID")
    if not parent_pid:
        return

    try:
        pid = int(parent_pid)
    except ValueError:
        return

    def monitor_parent() -> None:
        if sys.platform == "win32":
            import ctypes

            synchronize = 0x00100000
            infinite = 0xFFFFFFFF
            handle = ctypes.windll.kernel32.OpenProcess(synchronize, False, pid)
            if handle:
                ctypes.windll.kernel32.WaitForSingleObject(handle, infinite)
                os._exit(0)
            return

        while True:
            try:
                os.kill(pid, 0)
            except OSError:
                os._exit(0)
            time.sleep(2)

    threading.Thread(target=monitor_parent, daemon=True).start()


def load_backend_app():
    from app import app

    return app


def create_loopback_socket() -> socket.socket:
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("127.0.0.1", 0))
    server_socket.listen(128)
    return server_socket


def announce_backend_url(server_socket: socket.socket) -> None:
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
    app = load_app()
    server_socket = socket_factory()
    announce_backend_url(server_socket)
    server = server_factory(app)
    server.run(sockets=[server_socket])


def main() -> None:
    run_backend()


if __name__ == "__main__":
    main()
