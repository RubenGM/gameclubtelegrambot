#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
from psycopg.types.json import Json
from textual import on, work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, DataTable, Footer, Header, Input, Label, Select, Static


@dataclass(frozen=True)
class FieldDef:
    column: str
    label: str
    type: str
    nullable: bool = False


@dataclass(frozen=True)
class SoftDeleteDef:
    column: str
    value: str
    timestamp_column: str | None = None
    actor_column: str | None = None


@dataclass(frozen=True)
class ResourceDef:
    key: str
    label: str
    table: str
    id_column: str
    title_column: str
    subtitle_columns: tuple[str, ...]
    list_columns: tuple[str, ...]
    editable_fields: tuple[FieldDef, ...]
    soft_delete: SoftDeleteDef | None = None


RESOURCES: tuple[ResourceDef, ...] = (
    ResourceDef(
        "users",
        "Usuarios",
        "users",
        "telegram_user_id",
        "display_name",
        ("username", "status"),
        ("telegram_user_id", "display_name", "username", "status", "is_admin", "is_approved"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("username", "Username", "string", True),
            FieldDef("status", "Status", "string"),
            FieldDef("is_admin", "Admin", "boolean"),
            FieldDef("is_approved", "Approved", "boolean"),
            FieldDef("status_reason", "Status reason", "string", True),
        ),
    ),
    ResourceDef(
        "catalog_items",
        "Catalogo",
        "catalog_items",
        "id",
        "display_name",
        ("item_type", "lifecycle_status"),
        ("id", "display_name", "item_type", "lifecycle_status", "group_id", "family_id"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("original_name", "Original name", "string", True),
            FieldDef("description", "Description", "string", True),
            FieldDef("language", "Language", "string", True),
            FieldDef("publisher", "Publisher", "string", True),
            FieldDef("publication_year", "Publication year", "number", True),
            FieldDef("player_count_min", "Player min", "number", True),
            FieldDef("player_count_max", "Player max", "number", True),
            FieldDef("recommended_age", "Recommended age", "number", True),
            FieldDef("play_time_minutes", "Play time minutes", "number", True),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
            FieldDef("external_refs", "External refs", "json", True),
            FieldDef("metadata", "Metadata", "json", True),
        ),
        SoftDeleteDef("lifecycle_status", "inactive", "deactivated_at"),
    ),
    ResourceDef(
        "catalog_families",
        "Familias",
        "catalog_families",
        "id",
        "display_name",
        ("slug", "family_kind"),
        ("id", "display_name", "slug", "family_kind"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("slug", "Slug", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("family_kind", "Family kind", "string"),
        ),
    ),
    ResourceDef(
        "catalog_groups",
        "Grupos",
        "catalog_groups",
        "id",
        "display_name",
        ("slug", "family_id"),
        ("id", "display_name", "slug", "family_id"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("slug", "Slug", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("family_id", "Family ID", "number", True),
        ),
    ),
    ResourceDef(
        "catalog_loans",
        "Prestamos",
        "catalog_loans",
        "id",
        "borrower_display_name",
        ("item_id", "returned_at"),
        ("id", "item_id", "borrower_display_name", "due_at", "returned_at"),
        (
            FieldDef("borrower_display_name", "Borrower", "string"),
            FieldDef("due_at", "Due at", "timestamp", True),
            FieldDef("notes", "Notes", "string", True),
            FieldDef("returned_at", "Returned at", "timestamp", True),
        ),
        SoftDeleteDef("returned_at", "now", "updated_at", "returned_by_telegram_user_id"),
    ),
    ResourceDef(
        "club_tables",
        "Mesas",
        "club_tables",
        "id",
        "display_name",
        ("lifecycle_status", "recommended_capacity"),
        ("id", "display_name", "recommended_capacity", "lifecycle_status"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("recommended_capacity", "Capacity", "number", True),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
        ),
        SoftDeleteDef("lifecycle_status", "inactive", "deactivated_at"),
    ),
    ResourceDef(
        "schedule_events",
        "Actividades",
        "schedule_events",
        "id",
        "title",
        ("starts_at", "lifecycle_status"),
        ("id", "title", "starts_at", "capacity", "lifecycle_status"),
        (
            FieldDef("title", "Title", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("starts_at", "Starts at", "timestamp"),
            FieldDef("duration_minutes", "Duration", "number"),
            FieldDef("capacity", "Capacity", "number"),
            FieldDef("attendance_mode", "Attendance", "string"),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
            FieldDef("cancellation_reason", "Cancellation reason", "string", True),
        ),
        SoftDeleteDef("lifecycle_status", "cancelled", "cancelled_at", "cancelled_by_telegram_user_id"),
    ),
    ResourceDef(
        "venue_events",
        "Sala",
        "venue_events",
        "id",
        "name",
        ("starts_at", "lifecycle_status"),
        ("id", "name", "starts_at", "ends_at", "impact_level", "lifecycle_status"),
        (
            FieldDef("name", "Name", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("starts_at", "Starts at", "timestamp"),
            FieldDef("ends_at", "Ends at", "timestamp"),
            FieldDef("occupancy_scope", "Scope", "string"),
            FieldDef("impact_level", "Impact", "string"),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
            FieldDef("cancellation_reason", "Cancellation reason", "string", True),
        ),
        SoftDeleteDef("lifecycle_status", "cancelled", "cancelled_at"),
    ),
    ResourceDef(
        "group_purchases",
        "Compras",
        "group_purchases",
        "id",
        "title",
        ("purchase_mode", "lifecycle_status"),
        ("id", "title", "purchase_mode", "lifecycle_status", "join_deadline_at"),
        (
            FieldDef("title", "Title", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("purchase_mode", "Mode", "string"),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
            FieldDef("join_deadline_at", "Join deadline", "timestamp", True),
            FieldDef("confirm_deadline_at", "Confirm deadline", "timestamp", True),
            FieldDef("total_price_cents", "Total cents", "number", True),
            FieldDef("unit_price_cents", "Unit cents", "number", True),
            FieldDef("unit_label", "Unit label", "string", True),
        ),
        SoftDeleteDef("lifecycle_status", "cancelled", "cancelled_at"),
    ),
    ResourceDef(
        "storage_categories",
        "Storage categorias",
        "storage_categories",
        "id",
        "display_name",
        ("slug", "lifecycle_status"),
        ("id", "display_name", "slug", "storage_chat_id", "storage_thread_id", "lifecycle_status"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("slug", "Slug", "string"),
            FieldDef("description", "Description", "string", True),
            FieldDef("parent_category_id", "Parent ID", "number", True),
            FieldDef("storage_chat_id", "Chat ID", "number"),
            FieldDef("storage_thread_id", "Thread ID", "number"),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
        ),
        SoftDeleteDef("lifecycle_status", "archived", "archived_at"),
    ),
    ResourceDef(
        "storage_entries",
        "Storage entradas",
        "storage_entries",
        "id",
        "description",
        ("category_id", "lifecycle_status"),
        ("id", "category_id", "source_kind", "description", "lifecycle_status"),
        (
            FieldDef("description", "Description", "string", True),
            FieldDef("tags", "Tags", "json"),
            FieldDef("lifecycle_status", "Lifecycle", "string"),
        ),
        SoftDeleteDef("lifecycle_status", "deleted", "deleted_at", "deleted_by_telegram_user_id"),
    ),
    ResourceDef(
        "lfg_player_ads",
        "LFG jugadores",
        "lfg_player_ads",
        "id",
        "display_name",
        ("status", "telegram_user_id"),
        ("id", "display_name", "telegram_user_id", "status"),
        (
            FieldDef("display_name", "Display name", "string"),
            FieldDef("description", "Description", "string"),
            FieldDef("status", "Status", "string"),
        ),
        SoftDeleteDef("status", "cancelled", "cancelled_at"),
    ),
    ResourceDef(
        "lfg_group_ads",
        "LFG grupos",
        "lfg_group_ads",
        "id",
        "title",
        ("status", "creator_display_name"),
        ("id", "title", "creator_display_name", "status"),
        (
            FieldDef("title", "Title", "string"),
            FieldDef("description", "Description", "string"),
            FieldDef("seats_available", "Seats", "number", True),
            FieldDef("status", "Status", "string"),
        ),
        SoftDeleteDef("status", "cancelled", "cancelled_at"),
    ),
    ResourceDef(
        "audit_log",
        "Auditoria",
        "audit_log",
        "id",
        "summary",
        ("action_key", "target_type"),
        ("id", "action_key", "target_type", "target_id", "summary"),
        (),
    ),
)

SUMMARY_VIEW_KEY = "__summary__"
CONFIG_VIEW_KEY = "__config__"
BACKUPS_VIEW_KEY = "__backups__"
STORAGE_MANAGER_VIEW_KEY = "__storage_manager__"
RESOURCE_OPTIONS = (
    ("Resumen", SUMMARY_VIEW_KEY),
    ("Config", CONFIG_VIEW_KEY),
    ("Backups", BACKUPS_VIEW_KEY),
    ("Storage gestor", STORAGE_MANAGER_VIEW_KEY),
    *((resource.label, resource.key) for resource in RESOURCES),
)


class TextInputScreen(ModalScreen[str | None]):
    CSS = """
    TextInputScreen {
        align: center middle;
    }
    #dialog {
        width: 76;
        height: 11;
        border: thick $accent;
        background: $surface;
        padding: 1 2;
    }
    #dialog Input {
        margin-top: 1;
    }
    #dialog Horizontal {
        height: 3;
        margin-top: 1;
    }
    #dialog Button {
        margin-right: 1;
    }
    """

    def __init__(self, title: str, value: str = "") -> None:
        super().__init__()
        self.title = title
        self.value = value

    def compose(self) -> ComposeResult:
        with Vertical(id="dialog"):
            yield Label(self.title)
            yield Input(value=self.value, id="input")
            with Horizontal():
                yield Button("Guardar", id="save", variant="primary")
                yield Button("Cancelar", id="cancel")

    def on_mount(self) -> None:
        self.query_one("#input", Input).focus()

    @on(Button.Pressed, "#save")
    def save(self) -> None:
        self.dismiss(self.query_one("#input", Input).value)

    @on(Button.Pressed, "#cancel")
    def cancel(self) -> None:
        self.dismiss(None)

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.dismiss(event.value)


class ConfirmScreen(ModalScreen[bool]):
    CSS = """
    ConfirmScreen {
        align: center middle;
    }
    #confirm {
        width: 74;
        height: 9;
        border: thick $warning;
        background: $surface;
        padding: 1 2;
    }
    #confirm Horizontal {
        height: 3;
        margin-top: 1;
    }
    #confirm Button {
        margin-right: 1;
    }
    """

    def __init__(self, message: str) -> None:
        super().__init__()
        self.message = message

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm"):
            yield Label(self.message)
            with Horizontal():
                yield Button("Confirmar", id="yes", variant="error")
                yield Button("Cancelar", id="no")

    @on(Button.Pressed, "#yes")
    def yes(self) -> None:
        self.dismiss(True)

    @on(Button.Pressed, "#no")
    def no(self) -> None:
        self.dismiss(False)


class AdminConsoleTextualApp(App[None]):
    CSS = """
    Screen {
        background: #111318;
    }
    #top {
        height: 5;
        padding: 0 1;
        background: #171b22;
        border-bottom: solid #2b3340;
    }
    #title {
        text-style: bold;
        color: #f3f5f7;
    }
    #summary {
        color: #aeb6c2;
    }
    #main {
        height: 1fr;
    }
    #sidebar {
        width: 40;
        border-right: solid #2b3340;
        padding: 1;
        background: #151922;
        overflow-y: auto;
    }
    #workspace {
        width: 1fr;
        padding: 1;
    }
    Select {
        margin-bottom: 1;
    }
    #search-row {
        height: 3;
    }
    #search {
        width: 1fr;
    }
    #resources {
        height: 1fr;
        border: solid #2b3340;
    }
    #detail {
        height: 1fr;
        border: solid #2b3340;
        padding: 1 2;
        overflow-y: auto;
        background: #111318;
    }
    #actions {
        height: 3;
        margin-top: 1;
    }
    #actions Button {
        margin-right: 1;
    }
    #user-actions {
        height: auto;
        margin-top: 1;
        margin-bottom: 1;
        padding-bottom: 1;
        border-bottom: solid #2b3340;
    }
    .user-action-row {
        height: 3;
    }
    #user-actions Button {
        width: 17;
        margin-right: 1;
    }
    #status {
        height: 1;
        color: #f0c674;
    }
    """

    BINDINGS = [
        ("q", "quit", "Salir"),
        ("r", "refresh", "Refrescar"),
        ("e", "edit", "Editar"),
        ("m", "storage_move", "Mover"),
        ("space", "toggle_selection", "Seleccionar"),
        ("c", "clear_selection", "Limpiar sel."),
        ("a", "storage_archive", "Archivar"),
        ("u", "storage_restore", "Restaurar"),
        ("d", "soft_delete", "Desactivar"),
        ("D", "hard_delete", "Borrar"),
        ("b", "backup_create", "Backup"),
        ("R", "backup_restore", "Restaurar"),
        ("t", "telegram_token", "Token bot"),
        ("s", "service_start", "Start"),
        ("x", "service_stop", "Stop"),
        ("S", "service_restart", "Restart"),
    ]

    def __init__(self, config_path: Path, env_path: Path, service_name: str, operator_id: int) -> None:
        super().__init__()
        self.config_path = config_path
        self.env_path = env_path
        self.service_name = service_name
        self.operator_id = operator_id
        self.config = load_runtime_config(config_path, env_path)
        self.app_root = Path(__file__).resolve().parent.parent
        self.backup_dir = resolve_backup_dir(self.app_root)
        self.backup_cli = self.app_root / "scripts" / "backup-cli.sh"
        self.view_key = SUMMARY_VIEW_KEY
        self.resource = RESOURCES[0]
        self.selected_id: str | int | None = None
        self.selected_row: dict[str, Any] | None = None
        self.selected_backup: dict[str, Any] | None = None
        self.selected_storage_kind: str | None = None
        self.selected_storage_id: int | None = None
        self.selected_ids: set[str] = set()
        self.visible_row_ids: list[str] = []

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Vertical():
            with Vertical(id="top"):
                yield Static("Game Club Admin Console", id="title")
                yield Static("Cargando...", id="summary")
                yield Static("", id="status")
            with Horizontal(id="main"):
                with Vertical(id="sidebar"):
                    yield Select(
                        RESOURCE_OPTIONS,
                        prompt="Vista",
                        allow_blank=False,
                        value=self.view_key,
                        id="resource-select",
                    )
                    with Vertical(id="user-actions"):
                        yield Label("Usuarios")
                        with Horizontal(classes="user-action-row"):
                            yield Button("Aprobar", id="user-approve", variant="success", disabled=True)
                            yield Button("Pend.", id="user-pending", disabled=True)
                        with Horizontal(classes="user-action-row"):
                            yield Button("Bloquear", id="user-block", variant="warning", disabled=True)
                            yield Button("Revocar", id="user-revoke", variant="error", disabled=True)
                        with Horizontal(classes="user-action-row"):
                            yield Button("Admin", id="user-toggle-admin", disabled=True)
                            yield Button("Aprob.", id="user-toggle-approved", disabled=True)
                    yield Button("Refrescar", id="refresh", variant="primary")
                    yield Button("Editar", id="edit")
                    yield Button("Desactivar", id="soft-delete", variant="warning")
                    yield Button("Borrar definitivo", id="hard-delete", variant="error")
                    yield Button("Start servicio", id="service-start")
                    yield Button("Stop servicio", id="service-stop")
                    yield Button("Restart servicio", id="service-restart")
                    yield Label("Config")
                    yield Button("Cambiar token bot", id="telegram-token", variant="primary")
                    yield Label("Backups")
                    yield Button("Crear backup", id="backup-create", variant="success")
                    yield Button("Restaurar backup", id="backup-restore", variant="warning", disabled=True)
                    yield Button("Eliminar backup", id="backup-delete", variant="error", disabled=True)
                with Vertical(id="workspace"):
                    with Horizontal(id="search-row"):
                        yield Input(placeholder="Buscar en el recurso seleccionado", id="search")
                        yield Button("Buscar", id="search-button")
                    yield DataTable(id="resources")
                    yield Static("Selecciona una fila para ver el detalle.", id="detail")
        yield Footer()

    def on_mount(self) -> None:
        self.query_one(DataTable).focus()
        self.refresh_all()

    def action_refresh(self) -> None:
        self.refresh_all()

    def action_edit(self) -> None:
        self.start_edit()

    def action_storage_move(self) -> None:
        self.start_storage_move()

    def action_storage_archive(self) -> None:
        self.start_storage_archive()

    def action_storage_restore(self) -> None:
        self.start_storage_restore()

    def action_toggle_selection(self) -> None:
        self.toggle_selection()

    def action_clear_selection(self) -> None:
        self.clear_selection()

    def action_soft_delete(self) -> None:
        self.start_delete(False)

    def action_hard_delete(self) -> None:
        self.start_delete(True)

    def action_backup_create(self) -> None:
        self.start_backup_create()

    def action_backup_restore(self) -> None:
        self.start_backup_restore()

    def action_telegram_token(self) -> None:
        self.start_telegram_token_update()

    def action_service_start(self) -> None:
        self.run_service("start")

    def action_service_stop(self) -> None:
        self.run_service("stop")

    def action_service_restart(self) -> None:
        self.run_service("restart")

    @on(Select.Changed, "#resource-select")
    def resource_changed(self, event: Select.Changed) -> None:
        if event.value == Select.BLANK:
            self.query_one("#resource-select", Select).value = self.view_key
            return
        if event.value == SUMMARY_VIEW_KEY:
            self.view_key = SUMMARY_VIEW_KEY
            self.selected_id = None
            self.selected_row = None
            self.selected_backup = None
            self.clear_selection(show_status=False)
            self.update_user_action_state()
            self.update_backup_action_state()
            self.refresh_rows()
            return
        if event.value == BACKUPS_VIEW_KEY:
            self.view_key = BACKUPS_VIEW_KEY
            self.selected_id = None
            self.selected_row = None
            self.selected_backup = None
            self.clear_selection(show_status=False)
            self.update_user_action_state()
            self.update_backup_action_state()
            self.refresh_rows()
            return
        if event.value in (CONFIG_VIEW_KEY, STORAGE_MANAGER_VIEW_KEY):
            self.view_key = CONFIG_VIEW_KEY
            if event.value == STORAGE_MANAGER_VIEW_KEY:
                self.view_key = STORAGE_MANAGER_VIEW_KEY
            self.selected_id = None
            self.selected_row = None
            self.selected_backup = None
            self.selected_storage_kind = None
            self.selected_storage_id = None
            self.clear_selection(show_status=False)
            self.update_user_action_state()
            self.update_backup_action_state()
            self.refresh_rows()
            return
        resource = next((resource for resource in RESOURCES if resource.key == event.value), None)
        if resource is None:
            self.query_one("#resource-select", Select).value = self.view_key
            self.set_status(f"Vista no soportada: {event.value}")
            return
        self.view_key = resource.key
        self.resource = resource
        self.selected_id = None
        self.selected_row = None
        self.selected_backup = None
        self.clear_selection(show_status=False)
        self.update_user_action_state()
        self.update_backup_action_state()
        self.refresh_rows()

    @on(Input.Submitted, "#search")
    def search_submitted(self) -> None:
        self.clear_selection(show_status=False)
        self.refresh_rows()

    @on(Button.Pressed, "#search-button")
    def search_clicked(self) -> None:
        self.clear_selection(show_status=False)
        self.refresh_rows()

    @on(Button.Pressed, "#refresh")
    def refresh_clicked(self) -> None:
        self.refresh_all()

    @on(Button.Pressed, "#edit")
    def edit_clicked(self) -> None:
        self.start_edit()

    @on(Button.Pressed, "#soft-delete")
    def storage_archive_button_compat(self) -> None:
        if self.view_key == STORAGE_MANAGER_VIEW_KEY:
            self.start_storage_archive()
        else:
            self.start_delete(False)

    @on(Button.Pressed, "#hard-delete")
    def hard_delete_clicked(self) -> None:
        self.start_delete(True)

    @on(Button.Pressed, "#service-start")
    def service_start_clicked(self) -> None:
        self.run_service("start")

    @on(Button.Pressed, "#service-stop")
    def service_stop_clicked(self) -> None:
        self.run_service("stop")

    @on(Button.Pressed, "#service-restart")
    def service_restart_clicked(self) -> None:
        self.run_service("restart")

    @on(Button.Pressed, "#backup-create")
    def backup_create_clicked(self) -> None:
        self.start_backup_create()

    @on(Button.Pressed, "#backup-restore")
    def backup_restore_clicked(self) -> None:
        self.start_backup_restore()

    @on(Button.Pressed, "#backup-delete")
    def backup_delete_clicked(self) -> None:
        self.start_backup_delete()

    @on(Button.Pressed, "#telegram-token")
    def telegram_token_clicked(self) -> None:
        self.start_telegram_token_update()

    @on(Button.Pressed, "#user-approve")
    def user_approve_clicked(self) -> None:
        self.update_user_status("approved")

    @on(Button.Pressed, "#user-pending")
    def user_pending_clicked(self) -> None:
        self.update_user_status("pending")

    @on(Button.Pressed, "#user-block")
    def user_block_clicked(self) -> None:
        self.update_user_status("blocked")

    @on(Button.Pressed, "#user-revoke")
    def user_revoke_clicked(self) -> None:
        self.update_user_status("revoked")

    @on(Button.Pressed, "#user-toggle-admin")
    def user_toggle_admin_clicked(self) -> None:
        self.toggle_user_boolean("is_admin")

    @on(Button.Pressed, "#user-toggle-approved")
    def user_toggle_approved_clicked(self) -> None:
        self.toggle_user_boolean("is_approved")

    @on(DataTable.RowSelected)
    def row_selected(self, event: DataTable.RowSelected) -> None:
        if self.view_key == BACKUPS_VIEW_KEY:
            if event.row_key.value is None:
                return
            backup = next((backup for backup in self.list_backups() if backup["file_name"] == event.row_key.value), None)
            self.selected_backup = backup
            self.selected_id = None
            self.selected_row = None
            if backup is not None:
                self.render_backup_detail(backup)
            self.update_backup_action_state()
            return
        if self.view_key == STORAGE_MANAGER_VIEW_KEY:
            if event.row_key.value is None:
                return
            kind, item_id = parse_storage_row_key(str(event.row_key.value))
            if kind is None or item_id is None:
                return
            self.selected_id = str(event.row_key.value)
            self.selected_storage_kind = kind
            self.selected_storage_id = item_id
            self.load_storage_detail()
            return
        if self.view_key == SUMMARY_VIEW_KEY:
            return
        if event.row_key.value is None:
            return
        self.selected_id = event.row_key.value
        self.update_user_action_state()
        self.load_detail()

    def refresh_all(self) -> None:
        self.refresh_summary()
        self.refresh_rows()

    @work(thread=True)
    def refresh_summary(self) -> None:
        try:
            service_state = run_command(["systemctl", "show", self.service_name, "--property=ActiveState", "--value"])
            counts = self.fetch_counts()
            text = (
                f"Servicio: {service_state.strip() or 'unknown'} | "
                f"DB: {self.config['database']['name']}@{self.config['database']['host']}:{self.config['database']['port']} | "
                f"Usuarios: {counts.get('users', 0)} | Catalogo: {counts.get('catalog_items', 0)} | "
                f"Storage: {counts.get('storage_entries', 0)}"
            )
        except Exception as error:
            text = f"Error cargando resumen: {error}"
        self.call_from_thread(self.query_one("#summary", Static).update, text)

    @work(thread=True)
    def refresh_rows(self) -> None:
        try:
            if self.view_key == SUMMARY_VIEW_KEY:
                summary = self.fetch_current_state()
                self.call_from_thread(self.render_current_state, summary)
                self.call_from_thread(self.set_status, "Resumen actualizado.")
                return
            if self.view_key == BACKUPS_VIEW_KEY:
                backups = self.list_backups()
                self.call_from_thread(self.render_backups, backups)
                self.call_from_thread(self.set_status, f"{len(backups)} backups cargados.")
                return
            if self.view_key == CONFIG_VIEW_KEY:
                self.call_from_thread(self.render_config)
                self.call_from_thread(self.set_status, "Configuracion cargada.")
                return
            if self.view_key == STORAGE_MANAGER_VIEW_KEY:
                rows = self.fetch_storage_manager_rows(self.query_one("#search", Input).value.strip())
                self.call_from_thread(self.render_storage_manager_rows, rows)
                self.call_from_thread(self.set_status, f"{len(rows)} elementos de Storage cargados.")
                return
            rows = self.fetch_rows(self.resource, self.query_one("#search", Input).value.strip())
            self.call_from_thread(self.render_rows, rows)
            self.call_from_thread(self.set_status, f"{len(rows)} filas cargadas de {self.resource.label}.")
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error cargando filas: {error}")

    def render_rows(self, rows: list[dict[str, Any]]) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        self.visible_row_ids = [str(row.get(self.resource.id_column)) for row in rows]
        self.selected_ids.intersection_update(self.visible_row_ids)
        table.add_column("Sel", key="selected", width=3)
        for column in self.resource.list_columns:
            table.add_column(column)
        for row in rows:
            row_id = row.get(self.resource.id_column)
            row_key = str(row_id)
            selection_mark = "x" if row_key in self.selected_ids else ""
            table.add_row(selection_mark, *(format_cell(row.get(column)) for column in self.resource.list_columns), key=row_key)
        self.query_one("#detail", Static).update("Selecciona una fila para ver el detalle.")
        self.update_user_action_state()
        self.update_backup_action_state()

    def render_storage_manager_rows(self, rows: list[dict[str, Any]]) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        self.visible_row_ids = [str(row["row_key"]) for row in rows]
        self.selected_ids.intersection_update(self.visible_row_ids)
        table.add_column("Sel", key="selected", width=3)
        table.add_column("Tipo")
        table.add_column("ID")
        table.add_column("Nombre / descripcion")
        table.add_column("Ruta / categoria")
        table.add_column("Estado")
        table.add_column("Info")
        for row in rows:
            row_key = str(row["row_key"])
            table.add_row(
                "x" if row_key in self.selected_ids else "",
                row["kind_label"],
                str(row["id"]),
                row["title"],
                row["path"],
                row["status"],
                row["info"],
                key=row_key,
            )
        if self.selected_id not in self.visible_row_ids:
            self.selected_id = None
            self.selected_storage_kind = None
            self.selected_storage_id = None
        self.query_one("#detail", Static).update(
            "\n".join([
                "Storage gestor",
                "",
                "Selecciona una categoria o archivo.",
                "",
                "Acciones:",
                "- e: editar metadatos",
                "- m: mover categoria o archivo",
                "- a/d: archivar categoria o eliminar archivo",
                "- u: restaurar categoria o archivo",
                "",
                "No hay acciones para crear categorias ni archivos en esta vista.",
            ]),
        )
        self.update_user_action_state()
        self.update_backup_action_state()

    def render_backups(self, backups: list[dict[str, Any]]) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        self.visible_row_ids = []
        self.selected_ids.clear()
        table.add_column("Archivo")
        table.add_column("Tamano")
        table.add_column("Creado UTC")
        for backup in backups:
            table.add_row(
                backup["file_name"],
                format_bytes(backup["size_bytes"]),
                backup["modified_at"],
                key=backup["file_name"],
            )
        self.selected_backup = None
        self.query_one("#detail", Static).update("Selecciona un backup para restaurarlo o eliminarlo.")
        self.update_user_action_state()
        self.update_backup_action_state()

    def render_current_state(self, summary: dict[str, Any]) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        self.visible_row_ids = []
        self.selected_ids.clear()
        table.add_column("Area")
        table.add_column("Estado")
        table.add_column("Detalle")
        table.add_row("Servicio", summary["service_state"], self.service_name, key="service")
        table.add_row("Base de datos", summary["database_name"], summary["database_host"], key="database")
        for label, table_name in summary["tables"]:
            table.add_row(label, str(summary["counts"].get(table_name, 0)), table_name, key=table_name)
        lines = [
            "Resumen del estado actual",
            "",
            f"Servicio: {self.service_name}",
            f"Estado: {summary['service_state']}",
            f"Base de datos: {summary['database_name']}@{summary['database_host']}",
            "",
            "Contenido:",
        ]
        lines.extend(f"- {label}: {summary['counts'].get(table_name, 0)}" for label, table_name in summary["tables"])
        self.selected_id = None
        self.selected_row = None
        self.selected_backup = None
        self.query_one("#detail", Static).update("\n".join(lines))
        self.update_user_action_state()
        self.update_backup_action_state()

    def render_config(self) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        self.visible_row_ids = []
        self.selected_ids.clear()
        table.add_column("Campo")
        table.add_column("Valor")
        table.add_row("runtime.json", str(self.config_path), key="config-path")
        table.add_row("runtime .env", str(self.env_path), key="env-path")
        table.add_row("bot.publicName", str(self.config.get("bot", {}).get("publicName", "")), key="bot-name")
        table.add_row("bot.clubName", str(self.config.get("bot", {}).get("clubName", "")), key="club-name")
        table.add_row("telegram.token", "<hidden>", key="telegram-token")
        table.add_row("backup config", "runtime.json + runtime.env + /etc/default/gameclubtelegrambot", key="backup-config")
        self.selected_id = None
        self.selected_row = None
        self.selected_backup = None
        self.query_one("#detail", Static).update(
            "\n".join([
                "Configuracion runtime",
                "",
                f"runtime.json: {self.config_path}",
                f"runtime .env: {self.env_path}",
                "",
                "Acciones:",
                "- Pulsa t o el boton 'Cambiar token bot' para pegar el token nuevo de BotFather.",
                "- Despues pulsa S o 'Restart servicio' para aplicar el cambio.",
                "- Los backups completos incluyen runtime.json, runtime.env y /etc/default/gameclubtelegrambot.",
            ]),
        )
        self.update_user_action_state()
        self.update_backup_action_state()

    @work(thread=True)
    def load_detail(self) -> None:
        if self.selected_id is None:
            return
        try:
            row = self.fetch_detail(self.resource, self.selected_id)
            self.selected_row = row
            self.call_from_thread(self.render_detail, row)
            self.call_from_thread(self.update_user_action_state)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error cargando detalle: {error}")

    def render_detail(self, row: dict[str, Any]) -> None:
        editable = {field.column for field in self.resource.editable_fields}
        lines = [
            f"{self.resource.label} #{row.get(self.resource.id_column)}",
            f"Tabla: {self.resource.table}",
            "",
            "Campos:",
        ]
        for key, value in row.items():
            marker = "*" if key in editable else " "
            lines.append(f"{marker} {key}: {format_cell(value)}")
        lines.append("")
        lines.append("Campos editables:")
        lines.extend(f"- {field.column} ({field.type})" for field in self.resource.editable_fields)
        if not self.resource.editable_fields:
            lines.append("<ninguno>")
        self.query_one("#detail", Static).update("\n".join(lines))
        self.update_user_action_state()
        self.update_backup_action_state()

    def render_backup_detail(self, backup: dict[str, Any]) -> None:
        lines = [
            backup["file_name"],
            "",
            f"Ruta: {backup['file_path']}",
            f"Tamano: {format_bytes(backup['size_bytes'])}",
            f"Creado UTC: {backup['modified_at']}",
            "",
            "Acciones:",
            "- Crear backup genera una nueva copia completa.",
            "- Restaurar aplica el backup seleccionado.",
            "- Eliminar borra solo el archivo zip seleccionado.",
        ]
        self.query_one("#detail", Static).update("\n".join(lines))
        self.update_backup_action_state()

    def start_telegram_token_update(self) -> None:
        self.push_screen(TextInputScreen("Nuevo token de Telegram BotFather"), self.confirm_telegram_token_update)

    def confirm_telegram_token_update(self, token: str | None) -> None:
        if token is None or not token.strip():
            return
        if not re.match(r"^\d+:[A-Za-z0-9_-]{20,}$", token.strip()):
            self.set_status("El token no tiene el formato esperado de BotFather.")
            return
        self.push_screen(
            ConfirmScreen("Actualizar GAMECLUB_TELEGRAM_TOKEN en el .env runtime? Despues reinicia el servicio."),
            lambda confirmed: self.apply_telegram_token_update(token, confirmed),
        )

    @work(thread=True)
    def apply_telegram_token_update(self, token: str, confirmed: bool) -> None:
        if not confirmed:
            return
        try:
            update_env_file_value(self.env_path, "GAMECLUB_TELEGRAM_TOKEN", token.strip())
            self.config = load_runtime_config(self.config_path, self.env_path)
            self.call_from_thread(self.set_status, "Token actualizado. Pulsa S para reiniciar el servicio.")
            if self.view_key == CONFIG_VIEW_KEY:
                self.call_from_thread(self.render_config)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error actualizando token: {error}")

    def start_edit(self) -> None:
        if self.view_key == STORAGE_MANAGER_VIEW_KEY:
            self.start_storage_edit()
            return
        if self.view_key in (SUMMARY_VIEW_KEY, BACKUPS_VIEW_KEY, CONFIG_VIEW_KEY):
            self.set_status("Esta vista no tiene campos editables.")
            return
        if self.selected_id is None or not self.selected_row:
            self.set_status("Selecciona una fila antes de editar.")
            return
        if not self.resource.editable_fields:
            self.set_status("Este recurso no tiene campos editables.")
            return
        field_names = ", ".join(field.column for field in self.resource.editable_fields)
        self.push_screen(TextInputScreen(f"Campo editable ({field_names})"), self.handle_edit_field)

    def handle_edit_field(self, column: str | None) -> None:
        if not column:
            return
        field = next((field for field in self.resource.editable_fields if field.column == column.strip()), None)
        if not field:
            self.set_status(f"Campo no editable: {column}")
            return
        current_value = "" if not self.selected_row else format_cell(self.selected_row.get(field.column))
        self.push_screen(TextInputScreen(f"Nuevo valor para {field.column} ({field.type})", current_value), lambda value: self.apply_edit(field, value))

    @work(thread=True)
    def apply_edit(self, field: FieldDef, value: str | None) -> None:
        if value is None or self.selected_id is None:
            return
        try:
            parsed = parse_value(field, value)
            self.update_field(self.resource, self.selected_id, field, parsed)
            self.call_from_thread(self.set_status, f"{field.column} actualizado.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error editando: {error}")

    def start_delete(self, hard_delete: bool) -> None:
        if self.view_key == STORAGE_MANAGER_VIEW_KEY:
            if hard_delete:
                self.set_status("Storage gestor no permite borrado definitivo.")
                return
            self.start_storage_archive()
            return
        if self.view_key == SUMMARY_VIEW_KEY:
            self.set_status("El resumen no se puede borrar.")
            return
        target_ids = self.action_target_ids()
        if not target_ids:
            self.set_status("Selecciona una fila antes de borrar.")
            return
        action = "borrar definitivamente" if hard_delete else "desactivar/archivar"
        target_label = (
            f"{self.resource.label} #{target_ids[0]}"
            if len(target_ids) == 1
            else f"{len(target_ids)} filas de {self.resource.label}"
        )
        self.push_screen(
            ConfirmScreen(f"Confirmar {action} {target_label}?"),
            lambda confirmed: self.apply_delete(hard_delete, confirmed, target_ids),
        )

    @work(thread=True)
    def apply_delete(self, hard_delete: bool, confirmed: bool, target_ids: list[str]) -> None:
        if not confirmed or not target_ids:
            return
        try:
            self.delete_resources(self.resource, target_ids, hard_delete)
            self.selected_id = None
            self.selected_row = None
            self.selected_ids.clear()
            message = (
                f"{len(target_ids)} filas eliminadas."
                if hard_delete
                else f"{len(target_ids)} filas desactivadas/archivadas."
            )
            self.call_from_thread(self.set_status, message)
            self.call_from_thread(self.refresh_rows)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error borrando: {error}")

    @work(thread=True)
    def update_user_status(self, status: str) -> None:
        if self.resource.key != "users" or self.selected_id is None:
            self.call_from_thread(self.set_status, "Selecciona un usuario primero.")
            return
        try:
            self.set_user_status(self.selected_id, status)
            self.call_from_thread(self.set_status, f"Usuario actualizado a {status}.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_detail)
            self.call_from_thread(self.refresh_summary)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error actualizando usuario: {error}")

    @work(thread=True)
    def toggle_user_boolean(self, column: str) -> None:
        if self.resource.key != "users" or self.selected_id is None:
            self.call_from_thread(self.set_status, "Selecciona un usuario primero.")
            return
        try:
            next_value = not bool(self.selected_row.get(column)) if self.selected_row else True
            self.set_user_boolean(self.selected_id, column, next_value)
            self.call_from_thread(self.set_status, f"{column} actualizado a {next_value}.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_detail)
            self.call_from_thread(self.refresh_summary)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error actualizando usuario: {error}")

    @work(thread=True)
    def run_service(self, action: str) -> None:
        try:
            run_command(["systemctl", action, self.service_name])
            self.call_from_thread(self.set_status, f"Servicio {action} ejecutado.")
            self.call_from_thread(self.refresh_summary)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error systemctl {action}: {error}")

    def start_backup_create(self) -> None:
        self.push_screen(
            ConfirmScreen(f"Crear un backup completo en {self.backup_dir}?"),
            self.apply_backup_create,
        )

    @work(thread=True)
    def apply_backup_create(self, confirmed: bool) -> None:
        if not confirmed:
            return
        try:
            output = self.run_backup_command(["backup", "--output-dir", str(self.backup_dir), "--app-root", str(self.app_root)])
            archive = output.strip().splitlines()[-1] if output.strip() else "backup creado"
            self.call_from_thread(self.set_status, f"Backup creado: {archive}")
            self.call_from_thread(self.refresh_rows)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error creando backup: {error}")

    def start_backup_restore(self) -> None:
        if self.view_key != BACKUPS_VIEW_KEY or self.selected_backup is None:
            self.set_status("Selecciona un backup antes de restaurar.")
            return
        self.push_screen(
            ConfirmScreen(f"Restaurar {self.selected_backup['file_name']}?"),
            self.apply_backup_restore,
        )

    @work(thread=True)
    def apply_backup_restore(self, confirmed: bool) -> None:
        if not confirmed or self.selected_backup is None:
            return
        try:
            output = self.run_backup_command([
                "restore",
                self.selected_backup["file_path"],
                "--app-root",
                str(self.app_root),
                "--service-name",
                self.service_name,
            ])
            summary = output.strip().splitlines()[-1] if output.strip() else "restore completado"
            self.call_from_thread(self.set_status, summary)
            self.call_from_thread(self.refresh_all)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error restaurando backup: {error}")

    def start_backup_delete(self) -> None:
        if self.view_key != BACKUPS_VIEW_KEY or self.selected_backup is None:
            self.set_status("Selecciona un backup antes de eliminar.")
            return
        self.push_screen(
            ConfirmScreen(f"Eliminar {self.selected_backup['file_name']}?"),
            self.apply_backup_delete,
        )

    @work(thread=True)
    def apply_backup_delete(self, confirmed: bool) -> None:
        if not confirmed or self.selected_backup is None:
            return
        try:
            file_name = self.selected_backup["file_name"]
            self.run_backup_command(["delete", file_name, "--output-dir", str(self.backup_dir)])
            self.selected_backup = None
            self.call_from_thread(self.set_status, f"Backup eliminado: {file_name}")
            self.call_from_thread(self.refresh_rows)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error eliminando backup: {error}")

    def set_status(self, message: str) -> None:
        self.query_one("#status", Static).update(message)

    def action_target_ids(self) -> list[str]:
        if self.selected_ids:
            return [row_id for row_id in self.visible_row_ids if row_id in self.selected_ids]
        if self.selected_id is None:
            return []
        return [str(self.selected_id)]

    def toggle_selection(self) -> None:
        table = self.query_one(DataTable)
        if table.row_count == 0 or not table.is_valid_row_index(table.cursor_row):
            self.set_status("No hay fila actual para seleccionar.")
            return
        row_id = self.visible_row_ids[table.cursor_row]
        if row_id in self.selected_ids:
            self.selected_ids.remove(row_id)
            mark = ""
        else:
            self.selected_ids.add(row_id)
            mark = "x"
        table.update_cell(row_id, "selected", mark)
        count = len(self.selected_ids)
        plural = "s" if count != 1 else ""
        self.set_status(f"{count} fila{plural} seleccionada{plural}.")

    def clear_selection(self, show_status: bool = True) -> None:
        if not self.selected_ids:
            if show_status:
                self.set_status("No hay selección múltiple activa.")
            return
        table = self.query_one(DataTable)
        previous_ids = list(self.selected_ids)
        self.selected_ids.clear()
        for row_id in previous_ids:
            if row_id in self.visible_row_ids:
                table.update_cell(row_id, "selected", "")
        if show_status:
            self.set_status("Selección múltiple limpiada.")

    def update_user_action_state(self) -> None:
        enabled = self.view_key == "users" and self.selected_id is not None
        for button_id in (
            "#user-approve",
            "#user-pending",
            "#user-block",
            "#user-revoke",
            "#user-toggle-admin",
            "#user-toggle-approved",
        ):
            self.query_one(button_id, Button).disabled = not enabled

    def update_backup_action_state(self) -> None:
        backup_selected = self.view_key == BACKUPS_VIEW_KEY and self.selected_backup is not None
        self.query_one("#backup-create", Button).disabled = self.view_key != BACKUPS_VIEW_KEY
        self.query_one("#backup-restore", Button).disabled = not backup_selected
        self.query_one("#backup-delete", Button).disabled = not backup_selected

    def list_backups(self) -> list[dict[str, Any]]:
        if not self.backup_dir.exists():
            return []
        backups: list[dict[str, Any]] = []
        for path in self.backup_dir.glob("gameclub-backup-*.zip"):
            if not path.is_file():
                continue
            stats = path.stat()
            modified_at = datetime.fromtimestamp(stats.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            backups.append({
                "file_name": path.name,
                "file_path": str(path),
                "size_bytes": stats.st_size,
                "modified_at": modified_at,
                "mtime": stats.st_mtime,
            })
        backups.sort(key=lambda backup: backup["mtime"], reverse=True)
        return backups

    def run_backup_command(self, args: list[str]) -> str:
        return run_command([str(self.backup_cli), *args])

    def connection(self) -> psycopg.Connection[Any]:
        database = self.config["database"]
        return psycopg.connect(
            host=database["host"],
            port=database["port"],
            dbname=database["name"],
            user=database["user"],
            password=database["password"],
            sslmode="require" if database.get("ssl") else "disable",
        )

    def fetch_counts(self) -> dict[str, int]:
        tables = ("users", "catalog_items", "storage_entries", "schedule_events", "venue_events", "group_purchases")
        with self.connection() as conn:
            with conn.cursor() as cursor:
                result: dict[str, int] = {}
                for table in tables:
                    cursor.execute(f'select count(*) from "{table}"')
                    result[table] = int(cursor.fetchone()[0])
                return result

    def fetch_current_state(self) -> dict[str, Any]:
        database = self.config["database"]
        tables = (
            ("Usuarios", "users"),
            ("Catalogo", "catalog_items"),
            ("Storage", "storage_entries"),
            ("Actividades", "schedule_events"),
            ("Sala", "venue_events"),
            ("Compras", "group_purchases"),
        )
        return {
            "service_state": run_command(["systemctl", "show", self.service_name, "--property=ActiveState", "--value"]).strip()
            or "unknown",
            "database_name": database["name"],
            "database_host": f"{database['host']}:{database['port']}",
            "tables": tables,
            "counts": self.fetch_counts(),
        }

    def fetch_rows(self, resource: ResourceDef, search: str) -> list[dict[str, Any]]:
        columns = unique_columns((resource.id_column, resource.title_column, *resource.subtitle_columns, *resource.list_columns))
        where = ""
        params: list[Any] = []
        if search:
            clauses = [f'"{column}"::text ilike %s' for column in columns]
            where = "where " + " or ".join(clauses)
            params = [f"%{search}%" for _ in columns]
        sql = f'select {", ".join(f"""\"{column}\"""" for column in columns)} from "{resource.table}" {where} order by "{resource.id_column}" desc limit 300'
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(sql, params)
                return list(cursor.fetchall())

    def fetch_detail(self, resource: ResourceDef, row_id: str | int) -> dict[str, Any]:
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(f'select * from "{resource.table}" where "{resource.id_column}" = %s limit 1', [normalize_id(row_id)])
                row = cursor.fetchone()
                if row is None:
                    raise RuntimeError("fila no encontrada")
                return dict(row)

    def update_field(self, resource: ResourceDef, row_id: str | int, field: FieldDef, value: Any) -> None:
        assignments = [f'"{field.column}" = %s']
        params: list[Any] = [value]
        with self.connection() as conn:
            if table_has_column(conn, resource.table, "updated_at"):
                assignments.append('"updated_at" = now()')
            params.append(normalize_id(row_id))
            with conn.cursor() as cursor:
                cursor.execute(
                    f'update "{resource.table}" set {", ".join(assignments)} where "{resource.id_column}" = %s',
                    params,
                )

    def set_user_status(self, row_id: str | int, status: str) -> None:
        if status not in ("pending", "approved", "blocked", "revoked"):
            raise ValueError(f"status no soportado: {status}")
        normalized_id = normalize_id(row_id)
        with self.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('select status from "users" where "telegram_user_id" = %s', [normalized_id])
                existing = cursor.fetchone()
                if existing is None:
                    raise RuntimeError("usuario no encontrado")
                previous_status = str(existing[0])
                cursor.execute(
                    """
                    update "users"
                       set "status" = %s,
                           "is_approved" = %s,
                           "updated_at" = now(),
                           "approved_at" = case when %s = 'approved' then now() else "approved_at" end,
                           "blocked_at" = case when %s in ('blocked', 'revoked') then now() else null end,
                           "revoked_at" = case when %s = 'revoked' then now() else null end,
                           "status_reason" = %s
                     where "telegram_user_id" = %s
                    """,
                    [
                        status,
                        status == "approved",
                        status,
                        status,
                        status,
                        f"admin-console-textual {status}",
                        normalized_id,
                    ],
                )
                cursor.execute(
                    """
                    insert into "user_status_audit_log"
                        ("subject_telegram_user_id", "previous_status", "next_status", "changed_by_telegram_user_id", "reason")
                    values (%s, %s, %s, %s, %s)
                    """,
                    [normalized_id, previous_status, status, self.operator_id, f"admin-console-textual {status}"],
                )

    def set_user_boolean(self, row_id: str | int, column: str, value: bool) -> None:
        if column not in ("is_admin", "is_approved"):
            raise ValueError(f"campo booleano no soportado: {column}")
        normalized_id = normalize_id(row_id)
        with self.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f'select "{column}" from "users" where "telegram_user_id" = %s', [normalized_id])
                existing = cursor.fetchone()
                if existing is None:
                    raise RuntimeError("usuario no encontrado")
                previous_value = bool(existing[0])
                cursor.execute(f'update "users" set "{column}" = %s, "updated_at" = now() where "telegram_user_id" = %s', [value, normalized_id])
                if column == "is_admin":
                    cursor.execute(
                        """
                        insert into "user_permission_audit_log"
                            ("subject_telegram_user_id", "permission_key", "scope_type", "resource_type", "resource_id",
                             "previous_effect", "next_effect", "changed_by_telegram_user_id", "reason")
                        values (%s, 'admin', 'global', null, null, %s, %s, %s, %s)
                        """,
                        [
                            normalized_id,
                            "allow" if previous_value else None,
                            "allow" if value else None,
                            self.operator_id,
                            "admin-console-textual toggle admin",
                        ],
                    )

    def delete_resource(self, resource: ResourceDef, row_id: str | int, hard_delete: bool) -> None:
        self.delete_resources(resource, [str(row_id)], hard_delete)

    def delete_resources(self, resource: ResourceDef, row_ids: list[str], hard_delete: bool) -> None:
        with self.connection() as conn:
            with conn.cursor() as cursor:
                for row_id in row_ids:
                    self.execute_delete_resource(conn, cursor, resource, row_id, hard_delete)

    def execute_delete_resource(
        self,
        conn: psycopg.Connection[Any],
        cursor: psycopg.Cursor[Any],
        resource: ResourceDef,
        row_id: str | int,
        hard_delete: bool,
    ) -> None:
        if hard_delete or resource.soft_delete is None:
            self.delete_dependents(cursor, resource, row_id)
            cursor.execute(f'delete from "{resource.table}" where "{resource.id_column}" = %s', [normalize_id(row_id)])
            return
        soft = resource.soft_delete
        assignments = [f'"{soft.column}" = %s']
        params: list[Any] = ["now" if soft.value == "now" else soft.value]
        if soft.value == "now":
            assignments = [f'"{soft.column}" = now()']
            params = []
        if soft.timestamp_column:
            assignments.append(f'"{soft.timestamp_column}" = now()')
        if soft.actor_column:
            assignments.append(f'"{soft.actor_column}" = %s')
            params.append(self.operator_id)
        if table_has_column(conn, resource.table, "updated_at"):
            assignments.append('"updated_at" = now()')
        params.append(normalize_id(row_id))
        cursor.execute(
            f'update "{resource.table}" set {", ".join(assignments)} where "{resource.id_column}" = %s',
            params,
        )

    def delete_dependents(self, cursor: psycopg.Cursor[Any], resource: ResourceDef, row_id: str | int) -> None:
        normalized_id = normalize_id(row_id)
        if resource.table == "catalog_items":
            cursor.execute('delete from "catalog_media" where "item_id" = %s', [normalized_id])
            cursor.execute('delete from "catalog_loans" where "item_id" = %s', [normalized_id])

    def fetch_storage_manager_rows(self, search: str) -> list[dict[str, Any]]:
        filters = parse_storage_search(search)
        normalized_search = filters["text"]
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(
                    """
                    select c.*,
                           coalesce(children.child_count, 0) as child_count,
                           coalesce(entries.entry_count, 0) as entry_count
                      from "storage_categories" c
                      left join (
                        select "parent_category_id", count(*) as child_count
                          from "storage_categories"
                         where "category_purpose" = 'user_uploads'
                         group by "parent_category_id"
                      ) children on children."parent_category_id" = c."id"
                      left join (
                        select e."category_id", count(*) filter (where e."lifecycle_status" = 'active') as entry_count
                          from "storage_entries" e
                          join "storage_categories" ec on ec."id" = e."category_id"
                         where ec."category_purpose" = 'user_uploads'
                         group by e."category_id"
                      ) entries on entries."category_id" = c."id"
                     where c."category_purpose" = 'user_uploads'
                     order by c."display_name", c."id"
                    """
                )
                categories = [dict(row) for row in cursor.fetchall()]
                paths = build_storage_category_paths(categories)
                subtree_ids = (
                    storage_descendant_ids(categories, int(filters["subtree_category_id"])) | {int(filters["subtree_category_id"])}
                    if filters["subtree_category_id"] is not None
                    else None
                )
                rows: list[dict[str, Any]] = []
                if filters["type_filter"] in (None, "category"):
                    for category in categories:
                        category_id = int(category["id"])
                        if filters["category_status"] is not None and category["lifecycle_status"] != filters["category_status"]:
                            continue
                        if filters["direct_category_id"] is not None and category.get("parent_category_id") != filters["direct_category_id"]:
                            continue
                        if subtree_ids is not None and category_id not in subtree_ids:
                            continue
                        path = paths.get(category_id, category["display_name"])
                        haystack = " ".join([
                            str(category.get("display_name") or ""),
                            str(category.get("slug") or ""),
                            str(category.get("description") or ""),
                            path,
                        ]).lower()
                        if normalized_search and normalized_search not in haystack:
                            continue
                        rows.append({
                            "row_key": f"category:{category['id']}",
                            "kind_label": "Categoria",
                            "id": category["id"],
                            "title": category["display_name"],
                            "path": path,
                            "status": category["lifecycle_status"],
                            "info": f"{category['child_count']} subcat · {category['entry_count']} archivos",
                        })
                cursor.execute(
                    """
                    select e."id", e."category_id", e."description", e."tags", e."source_kind", e."lifecycle_status",
                           e."created_at", e."updated_at", c."display_name" as category_name,
                           count(m."id") as message_count,
                           string_agg(coalesce(m."original_file_name", m."attachment_kind"), ', ' order by m."sort_order", m."id") as message_labels
                      from "storage_entries" e
                      join "storage_categories" c on c."id" = e."category_id"
                      left join "storage_entry_messages" m on m."entry_id" = e."id"
                     where c."category_purpose" = 'user_uploads'
                     group by e."id", c."display_name"
                     order by e."updated_at" desc, e."id" desc
                     limit 500
                    """
                )
                entries = [dict(row) for row in cursor.fetchall()]
                if filters["type_filter"] == "category":
                    return rows
                for entry in entries:
                    entry_category_id = int(entry["category_id"])
                    if filters["entry_status"] is not None and entry["lifecycle_status"] != filters["entry_status"]:
                        continue
                    if filters["direct_category_id"] is not None and entry_category_id != filters["direct_category_id"]:
                        continue
                    if subtree_ids is not None and entry_category_id not in subtree_ids:
                        continue
                    category_path = paths.get(int(entry["category_id"]), str(entry["category_name"]))
                    tags = entry.get("tags") if isinstance(entry.get("tags"), list) else []
                    title = entry.get("description") or entry.get("message_labels") or f"Archivo {entry['id']}"
                    haystack = " ".join([
                        str(title),
                        " ".join(str(tag) for tag in tags),
                        str(entry.get("message_labels") or ""),
                        category_path,
                    ]).lower()
                    if normalized_search and normalized_search not in haystack:
                        continue
                    rows.append({
                        "row_key": f"entry:{entry['id']}",
                        "kind_label": "Archivo",
                        "id": entry["id"],
                        "title": str(title),
                        "path": category_path,
                        "status": entry["lifecycle_status"],
                        "info": f"{entry['message_count']} msg · {', '.join(tags) if tags else 'sin tags'}",
                    })
                return rows

    @work(thread=True)
    def load_storage_detail(self) -> None:
        if self.selected_storage_kind is None or self.selected_storage_id is None:
            return
        try:
            if self.selected_storage_kind == "category":
                detail = self.fetch_storage_category_detail(self.selected_storage_id)
            else:
                detail = self.fetch_storage_entry_detail(self.selected_storage_id)
            self.call_from_thread(self.query_one("#detail", Static).update, detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error cargando Storage: {error}")

    def fetch_storage_category_detail(self, category_id: int) -> str:
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute('select * from "storage_categories" where "id" = %s and "category_purpose" = %s', [category_id, "user_uploads"])
                category = cursor.fetchone()
                if category is None:
                    raise RuntimeError("categoria no encontrada")
                cursor.execute('select count(*) from "storage_categories" where "parent_category_id" = %s and "category_purpose" = %s', [category_id, "user_uploads"])
                child_count = int(cursor.fetchone()["count"])
                cursor.execute(
                    """
                    select count(*)
                      from "storage_entries" e
                      join "storage_categories" c on c."id" = e."category_id"
                     where e."category_id" = %s
                       and e."lifecycle_status" = %s
                       and c."category_purpose" = %s
                    """,
                    [category_id, "active", "user_uploads"],
                )
                active_entries = int(cursor.fetchone()["count"])
                return "\n".join([
                    f"Categoria #{category['id']}",
                    "",
                    f"Nombre: {category['display_name']}",
                    f"Slug: {category['slug']}",
                    f"Descripcion: {category['description'] or ''}",
                    f"Padre: {category['parent_category_id'] or '<raiz>'}",
                    f"Estado: {category['lifecycle_status']}",
                    f"Storage chat/thread: {category['storage_chat_id']} / {category['storage_thread_id']}",
                    f"Hijos directos: {child_count}",
                    f"Archivos activos directos: {active_entries}",
                    "",
                    "Acciones: e editar · m mover · a archivar · u reactivar",
                    "La vista no permite crear categorias ni editar chat/thread.",
                ])

    def fetch_storage_entry_detail(self, entry_id: int) -> str:
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute(
                    """
                    select e.*, c."display_name" as category_name
                      from "storage_entries" e
                      join "storage_categories" c on c."id" = e."category_id"
                     where e."id" = %s
                       and c."category_purpose" = %s
                    """,
                    [entry_id, "user_uploads"],
                )
                entry = cursor.fetchone()
                if entry is None:
                    raise RuntimeError("archivo no encontrado")
                cursor.execute(
                    """
                    select "storage_chat_id", "storage_thread_id", "storage_message_id", "attachment_kind",
                           "original_file_name", "mime_type", "file_size_bytes"
                      from "storage_entry_messages"
                     where "entry_id" = %s
                     order by "sort_order", "id"
                    """,
                    [entry_id],
                )
                messages = [dict(row) for row in cursor.fetchall()]
                lines = [
                    f"Archivo #{entry['id']}",
                    "",
                    f"Categoria: {entry['category_name']} ({entry['category_id']})",
                    f"Descripcion: {entry['description'] or ''}",
                    f"Tags: {format_cell(entry['tags'])}",
                    f"Origen: {entry['source_kind']}",
                    f"Estado: {entry['lifecycle_status']}",
                    f"Creado por: {entry['created_by_telegram_user_id']}",
                    f"Eliminado por: {entry['deleted_by_telegram_user_id'] or ''}",
                    "",
                    "Mensajes canonicos:",
                ]
                if messages:
                    for message in messages:
                        label = message["original_file_name"] or message["attachment_kind"]
                        lines.append(
                            f"- {label} · chat/thread/msg {message['storage_chat_id']}/{message['storage_thread_id']}/{message['storage_message_id']}"
                        )
                else:
                    lines.append("- <sin mensajes>")
                lines.extend([
                    "",
                    "Acciones: e editar · m mover · d eliminar · u restaurar",
                    "Mover en v1 cambia la categoria logica; los mensajes de Telegram no se copian.",
                ])
                return "\n".join(lines)

    def start_storage_edit(self) -> None:
        if self.selected_storage_kind is None or self.selected_storage_id is None:
            self.set_status("Selecciona una categoria o archivo de Storage.")
            return
        if self.selected_storage_kind == "category":
            self.push_screen(TextInputScreen("Campo: display_name, slug o description"), self.handle_storage_category_edit_field)
        else:
            self.push_screen(TextInputScreen("Campo: description, tags o lifecycle_status"), self.handle_storage_entry_edit_field)

    def handle_storage_category_edit_field(self, column: str | None) -> None:
        if column is None:
            return
        column = column.strip()
        if column not in ("display_name", "slug", "description"):
            self.set_status(f"Campo de categoria no editable: {column}")
            return
        current = self.fetch_storage_field("storage_categories", self.selected_storage_id, column)
        self.push_screen(TextInputScreen(f"Nuevo valor para {column}", "" if current is None else str(current)), lambda value: self.apply_storage_category_edit(column, value))

    def handle_storage_entry_edit_field(self, column: str | None) -> None:
        if column is None:
            return
        column = column.strip()
        if column not in ("description", "tags", "lifecycle_status"):
            self.set_status(f"Campo de archivo no editable: {column}")
            return
        current = self.fetch_storage_field("storage_entries", self.selected_storage_id, column)
        self.push_screen(TextInputScreen(f"Nuevo valor para {column}", format_cell(current)), lambda value: self.apply_storage_entry_edit(column, value))

    def fetch_storage_field(self, table: str, row_id: int | None, column: str) -> Any:
        if row_id is None:
            return None
        with self.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f'select "{column}" from "{table}" where "id" = %s', [row_id])
                row = cursor.fetchone()
                return row[0] if row else None

    @work(thread=True)
    def apply_storage_category_edit(self, column: str, value: str | None) -> None:
        if value is None or self.selected_storage_id is None:
            return
        try:
            self.update_storage_category_field(self.selected_storage_id, column, value)
            self.call_from_thread(self.set_status, "Categoria de Storage actualizada.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error editando categoria: {error}")

    @work(thread=True)
    def apply_storage_entry_edit(self, column: str, value: str | None) -> None:
        if value is None or self.selected_storage_id is None:
            return
        try:
            self.update_storage_entry_field(self.selected_storage_id, column, value)
            self.call_from_thread(self.set_status, "Archivo de Storage actualizado.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error editando archivo: {error}")

    def start_storage_move(self) -> None:
        if self.view_key != STORAGE_MANAGER_VIEW_KEY:
            self.set_status("Mover solo esta disponible en Storage gestor.")
            return
        if self.selected_storage_kind is None or self.selected_storage_id is None:
            self.set_status("Selecciona una categoria o archivo de Storage.")
            return
        prompt = "ID categoria padre destino, vacio para raiz" if self.selected_storage_kind == "category" else "ID categoria destino activa"
        self.push_screen(TextInputScreen(prompt), self.apply_storage_move_prompt)

    def apply_storage_move_prompt(self, raw_value: str | None) -> None:
        if raw_value is None:
            return
        if self.selected_storage_kind == "category":
            parent_id = None if raw_value.strip() == "" else int(raw_value.strip())
            self.push_screen(
                ConfirmScreen(f"Mover categoria #{self.selected_storage_id} a {'raiz' if parent_id is None else parent_id}?"),
                lambda confirmed: self.apply_storage_category_move(parent_id, confirmed),
            )
            return
        destination_id = int(raw_value.strip())
        self.push_screen(
            ConfirmScreen(f"Mover archivo #{self.selected_storage_id} a categoria {destination_id}?"),
            lambda confirmed: self.apply_storage_entry_move(destination_id, confirmed),
        )

    @work(thread=True)
    def apply_storage_category_move(self, parent_id: int | None, confirmed: bool) -> None:
        if not confirmed or self.selected_storage_id is None:
            return
        try:
            self.move_storage_category(self.selected_storage_id, parent_id)
            self.call_from_thread(self.set_status, "Categoria movida.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error moviendo categoria: {error}")

    @work(thread=True)
    def apply_storage_entry_move(self, category_id: int, confirmed: bool) -> None:
        if not confirmed or self.selected_storage_id is None:
            return
        try:
            self.move_storage_entry(self.selected_storage_id, category_id)
            self.call_from_thread(self.set_status, "Archivo movido.")
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error moviendo archivo: {error}")

    def start_storage_archive(self) -> None:
        if self.view_key != STORAGE_MANAGER_VIEW_KEY or self.selected_storage_kind is None or self.selected_storage_id is None:
            self.set_status("Selecciona un elemento de Storage.")
            return
        action = "archivar categoria" if self.selected_storage_kind == "category" else "eliminar archivo"
        self.push_screen(ConfirmScreen(f"Confirmar {action} #{self.selected_storage_id}?"), self.apply_storage_archive)

    @work(thread=True)
    def apply_storage_archive(self, confirmed: bool) -> None:
        if not confirmed or self.selected_storage_kind is None or self.selected_storage_id is None:
            return
        try:
            if self.selected_storage_kind == "category":
                self.archive_storage_category(self.selected_storage_id)
                message = "Categoria archivada."
            else:
                self.set_storage_entry_status(self.selected_storage_id, "deleted")
                message = "Archivo eliminado logicamente."
            self.call_from_thread(self.set_status, message)
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error archivando/eliminando: {error}")

    def start_storage_restore(self) -> None:
        if self.view_key != STORAGE_MANAGER_VIEW_KEY or self.selected_storage_kind is None or self.selected_storage_id is None:
            self.set_status("Selecciona un elemento de Storage.")
            return
        action = "reactivar categoria" if self.selected_storage_kind == "category" else "restaurar archivo"
        self.push_screen(ConfirmScreen(f"Confirmar {action} #{self.selected_storage_id}?"), self.apply_storage_restore)

    @work(thread=True)
    def apply_storage_restore(self, confirmed: bool) -> None:
        if not confirmed or self.selected_storage_kind is None or self.selected_storage_id is None:
            return
        try:
            if self.selected_storage_kind == "category":
                self.set_storage_category_status(self.selected_storage_id, "active")
                message = "Categoria reactivada."
            else:
                self.set_storage_entry_status(self.selected_storage_id, "active")
                message = "Archivo restaurado."
            self.call_from_thread(self.set_status, message)
            self.call_from_thread(self.refresh_rows)
            self.call_from_thread(self.load_storage_detail)
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error restaurando: {error}")

    def update_storage_category_field(self, category_id: int, column: str, value: str) -> None:
        if column not in ("display_name", "slug", "description"):
            raise ValueError("campo no editable")
        normalized = value.strip()
        if column in ("display_name", "slug") and not normalized:
            raise ValueError("el valor no puede estar vacio")
        if column == "slug" and not re.match(r"^[a-z0-9][a-z0-9_-]{0,127}$", normalized):
            raise ValueError("slug invalido")
        stored_value: Any = normalized if normalized else None
        with self.connection() as conn:
            with conn.cursor() as cursor:
                if column == "slug":
                    cursor.execute('select 1 from "storage_categories" where "slug" = %s and "id" <> %s limit 1', [stored_value, category_id])
                    if cursor.fetchone() is not None:
                        raise ValueError("slug ya usado")
                cursor.execute(f'update "storage_categories" set "{column}" = %s, "updated_at" = now() where "id" = %s', [stored_value, category_id])
                self.insert_audit_event(cursor, "storage.category.metadata_updated", "storage-category", category_id, "Categoria de storage actualizada", {"field": column})

    def update_storage_entry_field(self, entry_id: int, column: str, value: str) -> None:
        if column not in ("description", "tags", "lifecycle_status"):
            raise ValueError("campo no editable")
        if column == "tags":
            parsed = parse_storage_tags(value)
        elif column == "lifecycle_status":
            parsed = value.strip()
            if parsed not in ("active", "hidden", "deleted", "missing_source"):
                raise ValueError("estado invalido")
        else:
            parsed = value.strip() or None
        with self.connection() as conn:
            with conn.cursor() as cursor:
                if column == "lifecycle_status":
                    self.execute_storage_entry_status(cursor, entry_id, parsed)
                else:
                    cursor.execute(f'update "storage_entries" set "{column}" = %s, "updated_at" = now() where "id" = %s', [Json(parsed) if column == "tags" else parsed, entry_id])
                    self.insert_audit_event(cursor, "storage.entry.metadata_updated", "storage-entry", entry_id, "Archivo de storage actualizado", {"field": column})

    def move_storage_category(self, category_id: int, parent_id: int | None) -> None:
        if parent_id == category_id:
            raise ValueError("una categoria no puede ser su propio padre")
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute('select "id", "parent_category_id", "lifecycle_status" from "storage_categories"')
                categories = [dict(row) for row in cursor.fetchall()]
                if not any(int(category["id"]) == category_id for category in categories):
                    raise ValueError("categoria no encontrada")
                if parent_id is not None:
                    parent = next((category for category in categories if int(category["id"]) == parent_id), None)
                    if parent is None:
                        raise ValueError("categoria padre no encontrada")
                    if parent["lifecycle_status"] != "active":
                        raise ValueError("la categoria padre debe estar activa")
                    if category_id in storage_descendant_ids(categories, parent_id):
                        raise ValueError("no se puede mover una categoria dentro de una descendiente")
                cursor.execute('select "parent_category_id" from "storage_categories" where "id" = %s', [category_id])
                previous_parent_id = cursor.fetchone()["parent_category_id"]
                cursor.execute('update "storage_categories" set "parent_category_id" = %s, "updated_at" = now() where "id" = %s', [parent_id, category_id])
                self.insert_audit_event(cursor, "storage.category.moved", "storage-category", category_id, "Categoria de storage movida", {"previousParentCategoryId": previous_parent_id, "nextParentCategoryId": parent_id})

    def move_storage_entry(self, entry_id: int, category_id: int) -> None:
        with self.connection() as conn:
            with conn.cursor(row_factory=psycopg.rows.dict_row) as cursor:
                cursor.execute('select "lifecycle_status" from "storage_categories" where "id" = %s', [category_id])
                category = cursor.fetchone()
                if category is None:
                    raise ValueError("categoria destino no encontrada")
                if category["lifecycle_status"] != "active":
                    raise ValueError("la categoria destino debe estar activa")
                cursor.execute('select "category_id" from "storage_entries" where "id" = %s', [entry_id])
                entry = cursor.fetchone()
                if entry is None:
                    raise ValueError("archivo no encontrado")
                previous_category_id = entry["category_id"]
                cursor.execute('update "storage_entries" set "category_id" = %s, "updated_at" = now() where "id" = %s', [category_id, entry_id])
                self.insert_audit_event(cursor, "storage.entry.category_moved", "storage-entry", entry_id, "Archivo de storage movido", {"previousCategoryId": previous_category_id, "nextCategoryId": category_id})

    def archive_storage_category(self, category_id: int) -> None:
        with self.connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute('select count(*) from "storage_categories" where "parent_category_id" = %s and "lifecycle_status" = %s', [category_id, "active"])
                active_children = int(cursor.fetchone()[0])
                cursor.execute('select count(*) from "storage_entries" where "category_id" = %s and "lifecycle_status" = %s', [category_id, "active"])
                active_entries = int(cursor.fetchone()[0])
                if active_children or active_entries:
                    raise ValueError(f"bloqueado: {active_children} subcategorias activas y {active_entries} archivos activos")
                self.execute_storage_category_status(cursor, category_id, "archived")

    def set_storage_category_status(self, category_id: int, status: str) -> None:
        with self.connection() as conn:
            with conn.cursor() as cursor:
                self.execute_storage_category_status(cursor, category_id, status)

    def execute_storage_category_status(self, cursor: psycopg.Cursor[Any], category_id: int, status: str) -> None:
        if status not in ("active", "archived"):
            raise ValueError("estado de categoria invalido")
        cursor.execute(
            'update "storage_categories" set "lifecycle_status" = %s, "updated_at" = now(), "archived_at" = case when %s = %s then now() else null end where "id" = %s',
            [status, status, "archived", category_id],
        )
        action = "storage.category.archived" if status == "archived" else "storage.category.reactivated"
        self.insert_audit_event(cursor, action, "storage-category", category_id, f"Categoria de storage {status}", {"status": status})

    def set_storage_entry_status(self, entry_id: int, status: str) -> None:
        with self.connection() as conn:
            with conn.cursor() as cursor:
                self.execute_storage_entry_status(cursor, entry_id, status)

    def execute_storage_entry_status(self, cursor: psycopg.Cursor[Any], entry_id: int, status: str) -> None:
        if status not in ("active", "hidden", "deleted", "missing_source"):
            raise ValueError("estado de archivo invalido")
        cursor.execute(
            """
            update "storage_entries"
               set "lifecycle_status" = %s,
                   "updated_at" = now(),
                   "deleted_at" = case when %s = 'deleted' then now() else null end,
                   "deleted_by_telegram_user_id" = case when %s = 'deleted' then %s else null end
             where "id" = %s
            """,
            [status, status, status, self.operator_id or None, entry_id],
        )
        action = "storage.entry.deleted" if status == "deleted" else "storage.entry.restored" if status == "active" else "storage.entry.metadata_updated"
        self.insert_audit_event(cursor, action, "storage-entry", entry_id, f"Archivo de storage {status}", {"status": status})

    def insert_audit_event(self, cursor: psycopg.Cursor[Any], action_key: str, target_type: str, target_id: int, summary: str, details: dict[str, Any]) -> None:
        cursor.execute(
            """
            insert into "audit_log" ("actor_telegram_user_id", "action_key", "target_type", "target_id", "summary", "details")
            values (%s, %s, %s, %s, %s, %s)
            """,
            [self.operator_id or None, action_key, target_type, str(target_id), summary, Json(details)],
        )


def load_runtime_config(config_path: Path, env_path: Path) -> dict[str, Any]:
    env = parse_env_file(env_path)
    config = json.loads(config_path.read_text("utf-8"))
    database = config.setdefault("database", {})
    if "password" not in database and env.get("GAMECLUB_DATABASE_PASSWORD"):
        database["password"] = env["GAMECLUB_DATABASE_PASSWORD"]
    return config


def parse_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    result: dict[str, str] = {}
    for raw_line in path.read_text("utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        result[key.strip()] = value
    return result


def update_env_file_value(path: Path, key: str, value: str) -> None:
    lines = path.read_text("utf-8").splitlines() if path.exists() else []
    pattern = re.compile(rf"^(\s*(?:export\s+)?{re.escape(key)}\s*=\s*).*$")
    serialized = f'{key}="{value}"'
    updated = False
    output: list[str] = []

    for line in lines:
        if pattern.match(line):
            output.append(serialized)
            updated = True
        else:
            output.append(line)

    if not updated:
        if output and output[-1] != "":
            output.append("")
        output.append(serialized)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(output).rstrip() + "\n", "utf-8")


def unique_columns(columns: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(columns))


def normalize_id(value: str | int) -> str | int:
    if isinstance(value, int):
        return value
    return int(value) if value.lstrip("-").isdigit() else value


def parse_value(field: FieldDef, value: str) -> Any:
    stripped = value.strip()
    if field.nullable and (stripped == "" or stripped.lower() == "null"):
        return None
    if field.type == "number":
        return int(stripped) if stripped.lstrip("-").isdigit() else float(stripped)
    if field.type == "boolean":
        if stripped.lower() in ("true", "1", "yes", "y", "si", "sí"):
            return True
        if stripped.lower() in ("false", "0", "no", "n"):
            return False
        raise ValueError("usa true/false")
    if field.type == "json":
        return json.loads(stripped)
    return value


def format_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def format_bytes(bytes_value: int) -> str:
    if bytes_value >= 1073741824:
        return f"{bytes_value // 1073741824} GiB"
    if bytes_value >= 1048576:
        return f"{bytes_value // 1048576} MiB"
    if bytes_value >= 1024:
        return f"{bytes_value // 1024} KiB"
    return f"{bytes_value} B"


def parse_storage_row_key(value: str) -> tuple[str | None, int | None]:
    if ":" not in value:
        return None, None
    kind, raw_id = value.split(":", 1)
    if kind not in ("category", "entry") or not raw_id.isdigit():
        return None, None
    return kind, int(raw_id)


def build_storage_category_paths(categories: list[dict[str, Any]]) -> dict[int, str]:
    by_id = {int(category["id"]): category for category in categories}
    cache: dict[int, str] = {}

    def build(category_id: int, seen: set[int] | None = None) -> str:
        if category_id in cache:
            return cache[category_id]
        if seen is None:
            seen = set()
        if category_id in seen:
            return f"<ciclo:{category_id}>"
        seen.add(category_id)
        category = by_id.get(category_id)
        if category is None:
            return f"<desconocida:{category_id}>"
        name = str(category.get("display_name") or category_id)
        parent_id = category.get("parent_category_id")
        if parent_id is None:
            path = f"Almacenamiento / {name}"
        else:
            path = f"{build(int(parent_id), seen)} / {name}"
        cache[category_id] = path
        return path

    for category in categories:
        build(int(category["id"]))
    return cache


def storage_descendant_ids(categories: list[dict[str, Any]], category_id: int) -> set[int]:
    children_by_parent: dict[int, list[int]] = {}
    for category in categories:
        parent_id = category.get("parent_category_id")
        if parent_id is not None:
            children_by_parent.setdefault(int(parent_id), []).append(int(category["id"]))

    descendants: set[int] = set()
    stack = list(children_by_parent.get(category_id, []))
    while stack:
        child_id = stack.pop()
        if child_id in descendants:
            continue
        descendants.add(child_id)
        stack.extend(children_by_parent.get(child_id, []))
    return descendants


def parse_storage_tags(value: str) -> list[str]:
    stripped = value.strip()
    if not stripped:
        return []
    if stripped.startswith("["):
        parsed = json.loads(stripped)
        if not isinstance(parsed, list):
            raise ValueError("tags debe ser un array JSON o una lista separada por comas")
        values = parsed
    else:
        values = [part.strip() for part in stripped.split(",")]
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_value in values:
        tag = str(raw_value).strip().strip("#").lower()
        if not tag:
            continue
        if not re.match(r"^[a-z0-9_-]{1,64}$", tag):
            raise ValueError(f"tag invalido: {tag}")
        if tag not in seen:
            seen.add(tag)
            normalized.append(tag)
    return normalized


def parse_storage_search(value: str) -> dict[str, Any]:
    filters: dict[str, Any] = {
        "text": "",
        "type_filter": None,
        "category_status": None,
        "entry_status": None,
        "direct_category_id": None,
        "subtree_category_id": None,
    }
    text_parts: list[str] = []
    for raw_token in value.strip().split():
        token = raw_token.strip()
        lower = token.lower()
        if lower in ("type:category", "tipo:categoria"):
            filters["type_filter"] = "category"
            continue
        if lower in ("type:file", "type:entry", "tipo:archivo"):
            filters["type_filter"] = "entry"
            continue
        if lower.startswith(("category:", "categoria:")):
            status = lower.split(":", 1)[1]
            if status in ("active", "archived"):
                filters["category_status"] = status
                continue
        if lower.startswith(("entry:", "file:", "archivo:")):
            status = lower.split(":", 1)[1]
            if status in ("active", "hidden", "deleted", "missing_source"):
                filters["entry_status"] = status
                continue
        if lower.startswith(("direct:", "categoryid:")):
            raw_id = lower.split(":", 1)[1]
            if raw_id.isdigit():
                filters["direct_category_id"] = int(raw_id)
                continue
        if lower.startswith(("under:", "subtree:", "subarbol:")):
            raw_id = lower.split(":", 1)[1]
            if raw_id.isdigit():
                filters["subtree_category_id"] = int(raw_id)
                continue
        text_parts.append(token)
    filters["text"] = " ".join(text_parts).lower()
    return filters


def resolve_backup_dir(app_root: Path) -> Path:
    configured = os.environ.get("GAMECLUB_BACKUP_DIR")
    if configured:
        return Path(configured)
    installed_dir = Path("/var/backups/gameclubtelegrambot")
    if installed_dir.exists():
        return installed_dir
    return app_root / "backups"


def table_has_column(conn: psycopg.Connection[Any], table: str, column: str) -> bool:
    with conn.cursor() as cursor:
        cursor.execute(
            "select 1 from information_schema.columns where table_name = %s and column_name = %s limit 1",
            [table, column],
        )
        return cursor.fetchone() is not None


def run_command(args: list[str]) -> str:
    result = subprocess.run(args, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"{args[0]} failed")
    return result.stdout


def main() -> None:
    parser = argparse.ArgumentParser(description="Game Club Admin Console Textual")
    parser.add_argument("--service-name", default=os.environ.get("GAMECLUB_SERVICE_NAME", "gameclubtelegrambot.service"))
    parser.add_argument("--operator-id", type=int, default=int(os.environ.get("GAMECLUB_ADMIN_CONSOLE_OPERATOR_ID", "0")))
    parser.add_argument("--config", default=os.environ.get("GAMECLUB_CONFIG_PATH", "config/runtime.json"))
    parser.add_argument("--env", default=os.environ.get("GAMECLUB_ENV_PATH"))
    args = parser.parse_args()

    config_path = Path(args.config)
    env_path = Path(args.env) if args.env else config_path.parent / ".env"
    AdminConsoleTextualApp(config_path, env_path, args.service_name, args.operator_id).run()


if __name__ == "__main__":
    main()
