#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psycopg
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
        ("d", "soft_delete", "Desactivar"),
        ("D", "hard_delete", "Borrar"),
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
        self.resource = RESOURCES[0]
        self.selected_id: str | int | None = None
        self.selected_row: dict[str, Any] | None = None

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
                        [(resource.label, resource.key) for resource in RESOURCES],
                        value=self.resource.key,
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

    def action_soft_delete(self) -> None:
        self.start_delete(False)

    def action_hard_delete(self) -> None:
        self.start_delete(True)

    def action_service_start(self) -> None:
        self.run_service("start")

    def action_service_stop(self) -> None:
        self.run_service("stop")

    def action_service_restart(self) -> None:
        self.run_service("restart")

    @on(Select.Changed, "#resource-select")
    def resource_changed(self, event: Select.Changed) -> None:
        self.resource = next(resource for resource in RESOURCES if resource.key == event.value)
        self.selected_id = None
        self.selected_row = None
        self.update_user_action_state()
        self.refresh_rows()

    @on(Input.Submitted, "#search")
    def search_submitted(self) -> None:
        self.refresh_rows()

    @on(Button.Pressed, "#search-button")
    def search_clicked(self) -> None:
        self.refresh_rows()

    @on(Button.Pressed, "#refresh")
    def refresh_clicked(self) -> None:
        self.refresh_all()

    @on(Button.Pressed, "#edit")
    def edit_clicked(self) -> None:
        self.start_edit()

    @on(Button.Pressed, "#soft-delete")
    def soft_delete_clicked(self) -> None:
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
            rows = self.fetch_rows(self.resource, self.query_one("#search", Input).value.strip())
            self.call_from_thread(self.render_rows, rows)
            self.call_from_thread(self.set_status, f"{len(rows)} filas cargadas de {self.resource.label}.")
        except Exception as error:
            self.call_from_thread(self.set_status, f"Error cargando filas: {error}")

    def render_rows(self, rows: list[dict[str, Any]]) -> None:
        table = self.query_one(DataTable)
        table.clear(columns=True)
        table.cursor_type = "row"
        table.add_columns(*self.resource.list_columns)
        for row in rows:
            row_id = row.get(self.resource.id_column)
            table.add_row(*(format_cell(row.get(column)) for column in self.resource.list_columns), key=str(row_id))
        self.query_one("#detail", Static).update("Selecciona una fila para ver el detalle.")
        self.update_user_action_state()

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

    def start_edit(self) -> None:
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
        if self.selected_id is None:
            self.set_status("Selecciona una fila antes de borrar.")
            return
        action = "borrar definitivamente" if hard_delete else "desactivar/archivar"
        self.push_screen(
            ConfirmScreen(f"Confirmar {action} {self.resource.label} #{self.selected_id}?"),
            lambda confirmed: self.apply_delete(hard_delete, confirmed),
        )

    @work(thread=True)
    def apply_delete(self, hard_delete: bool, confirmed: bool) -> None:
        if not confirmed or self.selected_id is None:
            return
        try:
            self.delete_resource(self.resource, self.selected_id, hard_delete)
            self.selected_id = None
            self.selected_row = None
            self.call_from_thread(self.set_status, "Fila eliminada." if hard_delete else "Fila desactivada/archivada.")
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

    def set_status(self, message: str) -> None:
        self.query_one("#status", Static).update(message)

    def update_user_action_state(self) -> None:
        enabled = self.resource.key == "users" and self.selected_id is not None
        for button_id in (
            "#user-approve",
            "#user-pending",
            "#user-block",
            "#user-revoke",
            "#user-toggle-admin",
            "#user-toggle-approved",
        ):
            self.query_one(button_id, Button).disabled = not enabled

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
        with self.connection() as conn:
            with conn.cursor() as cursor:
                if hard_delete or resource.soft_delete is None:
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
