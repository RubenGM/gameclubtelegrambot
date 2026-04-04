#!/usr/bin/env python3
import json
import sys
import threading

import gi

gi.require_version('Gtk', '3.0')
gi.require_version('AyatanaAppIndicator3', '0.1')

from gi.repository import AyatanaAppIndicator3, GLib, Gtk  # noqa: E402


class TrayHost:
    def __init__(self) -> None:
        self.indicator = AyatanaAppIndicator3.Indicator.new(
            'gameclubtelegrambot',
            'applications-system-symbolic',
            AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS,
        )
        self.indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE)
        self.indicator.set_title('Game Club Bot')
        self.indicator.set_label('GC unknown', '')
        self.menu = Gtk.Menu()
        self.indicator.set_menu(self.menu)

    def run(self) -> None:
        thread = threading.Thread(target=self._stdin_loop, daemon=True)
        thread.start()
        self._emit({'type': 'ready'})
        Gtk.main()

    def _stdin_loop(self) -> None:
        for line in sys.stdin:
            payload = line.strip()
            if not payload:
                continue

            try:
                message = json.loads(payload)
            except Exception:
                continue

            GLib.idle_add(self._handle_message, message)

    def _handle_message(self, message: dict) -> bool:
        message_type = message.get('type')

        if message_type == 'snapshot':
            self._apply_snapshot(message)
        elif message_type == 'quit':
            Gtk.main_quit()

        return False

    def _apply_snapshot(self, snapshot: dict) -> None:
        status = str(snapshot.get('status', 'unknown'))
        tooltip = str(snapshot.get('tooltip', 'Game Club Bot'))
        items = snapshot.get('items', [])

        self.indicator.set_title(tooltip)
        self.indicator.set_label(self._label_for_status(status), '')

        for child in self.menu.get_children():
            self.menu.remove(child)

        for item in items:
            menu_item = Gtk.MenuItem(label=str(item.get('title', '')))
            menu_item.set_sensitive(bool(item.get('enabled', True)))

            action_id = item.get('id')
            if action_id and item.get('enabled', True):
                menu_item.connect('activate', self._on_activate, str(action_id))

            menu_item.show()
            self.menu.append(menu_item)

        self.menu.show_all()

    def _on_activate(self, _widget: Gtk.MenuItem, action_id: str) -> None:
        self._emit({'type': 'click', 'actionId': action_id})

    def _emit(self, payload: dict) -> None:
        sys.stdout.write(json.dumps(payload) + '\n')
        sys.stdout.flush()

    def _label_for_status(self, status: str) -> str:
        labels = {
            'active': 'GC active',
            'inactive': 'GC off',
            'failed': 'GC failed',
            'activating': 'GC starting',
            'deactivating': 'GC stopping',
            'busy': 'GC busy',
            'unknown': 'GC unknown',
        }
        return labels.get(status, 'GC unknown')


if __name__ == '__main__':
    Gtk.init()
    TrayHost().run()
