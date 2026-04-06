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
        self.menu = Gtk.Menu()
        self.menu_items = {}
        self.indicator = AyatanaAppIndicator3.Indicator.new(
            'gameclubtelegrambot',
            'applications-system-symbolic',
            AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS,
        )
        self.indicator.set_menu(self.menu)
        self.indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE)
        self.indicator.set_title('Game Club Bot')
        self.indicator.set_label('', '')

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
        tooltip = str(snapshot.get('tooltip', 'Game Club Bot'))
        items = snapshot.get('items', [])
        active_ids = set()

        self.indicator.set_title(tooltip)
        self.indicator.set_label('', '')

        # Keep Gtk.MenuItem instances stable so dbusmenu item IDs stay clickable across refreshes.
        for index, item in enumerate(items):
            action_id = str(item.get('id', f'item-{index}'))
            active_ids.add(action_id)

            menu_item = self.menu_items.get(action_id)
            if menu_item is None:
                menu_item = Gtk.MenuItem(label=str(item.get('title', '')))
                if action_id != 'status':
                    menu_item.connect('activate', self._on_activate, action_id)
                self.menu_items[action_id] = menu_item
                self.menu.append(menu_item)

            menu_item.set_label(str(item.get('title', '')))
            menu_item.set_sensitive(bool(item.get('enabled', True)))
            self.menu.reorder_child(menu_item, index)
            menu_item.show()

        stale_ids = [action_id for action_id in self.menu_items.keys() if action_id not in active_ids]
        for action_id in stale_ids:
            menu_item = self.menu_items.pop(action_id)
            self.menu.remove(menu_item)

        self.menu.show_all()

    def _on_activate(self, _widget: Gtk.MenuItem, action_id: str) -> None:
        self._emit({'type': 'click', 'actionId': action_id})

    def _emit(self, payload: dict) -> None:
        sys.stdout.write(json.dumps(payload) + '\n')
        sys.stdout.flush()

if __name__ == '__main__':
    Gtk.init()
    TrayHost().run()
