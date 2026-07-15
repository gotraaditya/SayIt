import contextlib
import io
import unittest

import backend_server


class BackendServerStartupTests(unittest.TestCase):
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

    def test_app_load_failure_does_not_announce_or_bind_socket(self):
        events: list[str] = []

        def load_app():
            events.append("load_app")
            raise RuntimeError("model load failed")

        def socket_factory():
            events.append("socket")
            raise AssertionError("socket should not be created before app load succeeds")

        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(RuntimeError, "model load failed"):
                backend_server.run_backend(
                    load_app=load_app,
                    socket_factory=socket_factory,
                    server_factory=lambda _app: None,
                )

        self.assertEqual(events, ["load_app"])
        self.assertEqual(output.getvalue(), "")

    def test_backend_url_is_announced_before_server_run(self):
        events: list[str] = []

        class FakeSocket:
            def getsockname(self):
                events.append("getsockname")
                return ("127.0.0.1", 49152)

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
        self.assertEqual(events, ["getsockname", ("run", [fake_socket])])


if __name__ == "__main__":
    unittest.main()
