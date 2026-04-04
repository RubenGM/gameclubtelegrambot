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
        self.window_buttons = {}
        self.indicator = AyatanaAppIndicator3.Indicator.new(
            'gameclubtelegrambot',
            'applications-system-symbolic',
            AyatanaAppIndicator3.IndicatorCategory.APPLICATION_STATUS,
        )
        self.indicator.set_menu(self.menu)
        self.indicator.set_status(AyatanaAppIndicator3.IndicatorStatus.ACTIVE)
        self.indicator.set_title('Game Club Bot')
        self.indicator.set_label('', '')

        self.control_window = Gtk.Window(title='Game Club Bot control')
        self.control_window.set_default_size(320, 1)
        self.control_window.connect('delete-event', self._on_window_delete)

        root_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=12)
        root_box.set_border_width(12)

        self.status_label = Gtk.Label(label='Game Club Bot: iniciant...', xalign=0)
        self.status_label.set_line_wrap(True)
        self.status_label.set_selectable(False)

        info_label = Gtk.Label(
            label='Control local del bot. La safata queda com a indicador visual.',
            xalign=0,
        )
        info_label.set_line_wrap(True)
        info_label.set_selectable(False)

        self.actions_box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)

        root_box.pack_start(self.status_label, False, False, 0)
        root_box.pack_start(info_label, False, False, 0)
        root_box.pack_start(self.actions_box, True, True, 0)
        self.control_window.add(root_box)
        self.control_window.show_all()

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
        active_ids = set()

        self.indicator.set_title(tooltip)
        self.indicator.set_label('', '')
        self.status_label.set_text(tooltip)
        self.control_window.set_title(tooltip)

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
        self._sync_control_window(items)

    def _on_activate(self, _widget: Gtk.MenuItem, action_id: str) -> None:
        self._emit({'type': 'click', 'actionId': action_id})

    def _on_window_button_clicked(self, _widget: Gtk.Button, action_id: str) -> None:
        self._emit({'type': 'click', 'actionId': action_id})

    def _on_window_delete(self, _widget: Gtk.Window, _event) -> bool:
        self.control_window.hide()
        return True

    def _sync_control_window(self, items: list[dict]) -> None:
        active_ids = set()
        button_index = 0

        for item in items:
            action_id = str(item.get('id', ''))
            if action_id == 'status':
                continue

            active_ids.add(action_id)
            button = self.window_buttons.get(action_id)
            if button is None:
                button = Gtk.Button(label=str(item.get('title', '')))
                button.connect('clicked', self._on_window_button_clicked, action_id)
                self.window_buttons[action_id] = button
                self.actions_box.pack_start(button, False, False, 0)

            button.set_label(str(item.get('title', '')))
            button.set_sensitive(bool(item.get('enabled', True)))
            self.actions_box.reorder_child(button, button_index)
            button.show()
            button_index += 1

        stale_ids = [action_id for action_id in self.window_buttons.keys() if action_id not in active_ids]
        for action_id in stale_ids:
            button = self.window_buttons.pop(action_id)
            self.actions_box.remove(button)

        self.control_window.show_all()

    def _emit(self, payload: dict) -> None:
        sys.stdout.write(json.dumps(payload) + '\n')
        sys.stdout.flush()

if __name__ == '__main__':
    Gtk.init()
    TrayHost().run()
