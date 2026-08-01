import errno
import os
import socket


def requested_backend_port() -> int:
    configured_port = os.environ.get("SAYIT_BACKEND_PORT", "0").strip()
    if not configured_port:
        return 0

    try:
        port = int(configured_port)
    except ValueError:
        return 0

    if 0 <= port <= 65535:
        return port
    return 0


def bind_loopback_socket(port: int) -> socket.socket:
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server_socket.bind(("127.0.0.1", port))
        server_socket.listen(128)
        return server_socket
    except OSError:
        server_socket.close()
        raise


def create_loopback_socket() -> socket.socket:
    preferred_port = requested_backend_port()
    try:
        return bind_loopback_socket(preferred_port)
    except OSError as error:
        if preferred_port and error.errno in {errno.EADDRINUSE, errno.EACCES}:
            return bind_loopback_socket(0)
        raise
