# Secrets and Runtime Config TUI Design

## Goal

Make runtime configuration safer by moving secret values out of JSON and into a host-local `.env` file, while adding a terminal TUI that can initialize and edit both files from one flow.

## Background

The current runtime model keeps secrets in `config/runtime.json`. That is workable for bootstrap, but it increases accidental exposure risk during copies, backups, and deployment handoff.

The approved direction is:

- JSON keeps non-secret structure.
- `.env` keeps secret values.
- The app loads `.env` at runtime.
- Real environment variables still override `.env` values.

## Scope

### In scope

- A runtime loader that reads JSON plus `.env`.
- A single full-screen TUI for init/edit workflows.
- Automatic routing of each field to the correct file on save.
- Validation for missing or malformed runtime values.
- Documentation updates for local and Debian workflows.

### Out of scope

- New secret storage backends.
- Remote secret managers.
- Multi-user collaboration features inside the TUI.

## File Layout

Use two runtime files by default:

- `config/runtime.json` for non-secret config.
- `.env` for secret values.

For Debian installs, the deployed copy should use the same split, but live under the host app/config directory rather than the repo workspace.

## Runtime Model

The loader should build the effective runtime config in this order:

1. Parse `config/runtime.json`.
2. Load `.env` if present.
3. Merge `.env` values into the runtime model for fields marked as secret-backed.
4. Override both with real process environment variables.
5. Validate the final merged object with the existing schema.

This keeps `.env` as the default secret source without blocking emergency overrides from the service environment.

## Config Field Routing

Each runtime field needs an explicit destination definition:

- `json`: written to `config/runtime.json`
- `env`: written to `.env`

Secret values should be routed to `.env` at minimum:

- `telegram.token`
- `bgg.apiKey`
- `database.password`
- `adminElevation.passwordHash`

Non-secret fields remain in JSON:

- app identity fields
- database host, port, name, user, ssl
- bootstrap identity fields
- notification defaults
- feature flags

## TUI Design

The TUI should present one merged form, not two separate editors.

Recommended layout:

- left panel: grouped fields
- right panel: contextual help and validation messages
- masked input for secret-backed fields
- visible file destination label per field
- save indicator showing whether a field will land in JSON or `.env`

User actions:

- navigate fields with keyboard
- edit any field inline
- create missing files during init
- save all fields in one operation
- revalidate before exiting

The editor should support both:

- first-time initialization from example defaults
- editing an existing config without losing unrelated values

## Save Behavior

On save, the TUI should:

1. Validate the merged model.
2. Split values by destination file.
3. Write JSON deterministically with stable key ordering.
4. Write `.env` in standard `KEY=value` form.
5. Use temp-file-then-rename writes to avoid partial corruption.

The TUI must not copy secret values into JSON, even transiently.

## Migration Behavior

If an existing `runtime.json` contains secret values, the TUI should import them into the merged model and then save them into `.env` on the next write.

This allows a one-time migration path from the current secret-in-JSON setup without a separate conversion tool.

## Validation Rules

Validation should fail fast when:

- a required secret is missing from `.env` and not present in the real environment
- JSON is malformed
- a numeric field is outside its allowed range
- a boolean or enum field has an invalid value
- a field marked secret-backed is accidentally placed in JSON

The TUI should show field-level errors before save, not just a generic failure.

## CLI Entry Point

Add a terminal entry point for the editor, likely via an npm script and a Node CLI module.

Behavior:

- no args: open the TUI on the current runtime files
- init mode: create missing files with safe defaults
- edit mode: load existing files and preserve values not changed by the user

The command should be usable from both the repo workspace and a deployed host.

## Documentation Updates

Update docs to describe:

- `.env` as the secret source
- `config/runtime.json` as the structural config source
- the loader precedence rules
- how the Debian service locates its env file
- how to use the TUI to initialize or edit config safely

## Testing

Add coverage for:

- JSON-only load
- JSON + `.env` load
- real env overriding `.env`
- save routing for secret and non-secret fields
- missing-secret validation failure
- migration of legacy secret values out of JSON

If the TUI has reusable state helpers, test those separately from terminal rendering.

## Acceptance Criteria

- Secrets no longer need to live in `runtime.json`.
- The app can boot using `.env` at runtime.
- The TUI can edit all fields in one flow and save each value to the correct file.
- Existing configs can be migrated without manual file surgery.
- Validation fails clearly when a required secret is missing.
