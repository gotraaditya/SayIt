import contextlib
import io
import os
import socket
import unittest

import backend_server


class BackendServerStartupTests(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("SAYIT_BACKEND_PORT", None)

    def test_windows_parent_monitor_uses_wait_handle_when_available(self):
        events: list[tuple[str, int]] = []

        backend_server.monitor_parent_process(
            1234,
            platform_name="win32",
            wait_for_windows_parent=lambda pid: events.append(("wait", pid)) or True,
            poll_parent=lambda pid: events.append(("poll", pid)),
        )

        self.assertEqual(events, [("wait", 1234)])

    def test_windows_parent_monitor_falls_back_to_polling(self):
        events: list[tuple[str, int]] = []

        backend_server.monitor_parent_process(
            1234,
            platform_name="win32",
            wait_for_windows_parent=lambda pid: events.append(("wait", pid)) or False,
            poll_parent=lambda pid: events.append(("poll", pid)),
        )

        self.assertEqual(events, [("wait", 1234), ("poll", 1234)])

    def test_backend_url_is_announced_before_app_load(self):
        events: list[str] = []

        class FakeSocket:
            def getsockname(self):
                events.append("getsockname")
                return ("127.0.0.1", 49152)

            def close(self):
                events.append("close")

        def load_app():
            events.append("load_app")
            raise RuntimeError("model load failed")

        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "model load failed"):
                backend_server.run_backend(
                    load_app=load_app,
                    socket_factory=lambda: FakeSocket(),
                    server_factory=lambda _app: None,
                )

        self.assertEqual(events, ["getsockname", "load_app", "close"])
        self.assertEqual(output.getvalue(), "http://127.0.0.1:49152\n")

    def test_backend_url_is_announced_before_server_run(self):
        events: list[str] = []

        class FakeSocket:
            def getsockname(self):
                events.append("getsockname")
                return ("127.0.0.1", 49152)

            def close(self):
                events.append("close")

        class FakeServer:
            def run(self, sockets):
                events.append(("run", sockets))

        fake_socket = FakeSocket()
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            backend_server.run_backend(
                load_app=lambda: "app",
                socket_factory=lambda: fake_socket,
                server_factory=lambda app: FakeServer(),
            )

        self.assertEqual(output.getvalue(), "http://127.0.0.1:49152\n")
        self.assertEqual(events, ["getsockname", ("run", [fake_socket]), "close"])

    def test_requested_occupied_port_falls_back_to_free_port(self):
        occupied_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        occupied_socket.bind(("127.0.0.1", 0))
        occupied_socket.listen(1)
        occupied_port = occupied_socket.getsockname()[1]
        os.environ["SAYIT_BACKEND_PORT"] = str(occupied_port)

        try:
            server_socket = backend_server.create_loopback_socket()
            try:
                self.assertNotEqual(server_socket.getsockname()[1], occupied_port)
            finally:
                server_socket.close()
        finally:
            occupied_socket.close()

    def test_invalid_requested_port_uses_free_port(self):
        os.environ["SAYIT_BACKEND_PORT"] = "not-a-port"

        server_socket = backend_server.create_loopback_socket()
        try:
            self.assertEqual(server_socket.getsockname()[0], "127.0.0.1")
            self.assertGreater(server_socket.getsockname()[1], 0)
        finally:
            server_socket.close()

    def test_noisy_app_load_does_not_corrupt_backend_url_announcement(self):
        class FakeSocket:
            def getsockname(self):
                return ("127.0.0.1", 49152)

            def close(self):
                pass

        class FakeServer:
            def run(self, sockets):
                pass

        output = io.StringIO()
        errors = io.StringIO()

        def load_app():
            print("third-party import warning")
            return "app"

        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            backend_server.run_backend(
                load_app=load_app,
                socket_factory=lambda: FakeSocket(),
                server_factory=lambda app: FakeServer(),
            )

        self.assertEqual(output.getvalue(), "http://127.0.0.1:49152\n")
        self.assertEqual(errors.getvalue(), "third-party import warning\n")


if __name__ == "__main__":
    unittest.main()
