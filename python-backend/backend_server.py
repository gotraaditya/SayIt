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


def main() -> None:
    exit_when_parent_exits()
    from app import app

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_socket.bind(("127.0.0.1", 0))
    server_socket.listen(128)

    host, port = server_socket.getsockname()
    print(f"http://{host}:{port}", flush=True)

    config = uvicorn.Config(app, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    server.run(sockets=[server_socket])


if __name__ == "__main__":
    main()
