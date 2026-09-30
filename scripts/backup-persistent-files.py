#!/usr/bin/env python3
"""Persistent filesystem payload for backup-full/restore-full (stdlib only)."""
import argparse
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess


def entries(config_path, app_root):
    config = json.loads(Path(config_path).read_text())
    root = Path(os.path.abspath(app_root))
    def resolve(value):
        path = Path(value)
        return Path(os.path.abspath(path if path.is_absolute() else root / path))
    return {
        'feedback': (resolve(config.get('httpServer', {}).get('feedbackFile', 'data/feedback.jsonl')), 'data/feedback.jsonl', 'file'),
        'http-assets': (root / 'data/http-assets', 'data/http-assets', 'directory'),
        'google-calendar': (resolve(config.get('googleCalendar', {}).get('serviceAccountFile', '/var/lib/gameclubtelegrambot/google-calendar-service-account.json')), 'integrations/google-calendar.json', 'file'),
    }


def check_tree(path):
    mode = path.lstat().st_mode
    if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
        raise ValueError(f'Unsupported persistent file type: {path}')
    if stat.S_ISDIR(mode):
        for child in path.iterdir():
            check_tree(child)


def copy_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with source.open('rb') as incoming, target.open('wb') as outgoing:
            shutil.copyfileobj(incoming, outgoing)
    except PermissionError:
        # Operator backups may need to read service-owned credentials (0600).
        with target.open('wb') as outgoing:
            subprocess.run(['sudo', '-n', 'cat', '--', str(source)], stdout=outgoing, check=True)
    target.chmod(0o600)


def copy_tree(source, target):
    target.mkdir(parents=True, exist_ok=True, mode=0o750)
    for child in source.iterdir():
        destination = target / child.name
        if child.is_dir():
            copy_tree(child, destination)
        else:
            copy_file(child, destination)


def payload(archive, specs):
    manifest = archive / 'metadata/persistent-files.json'
    if not manifest.exists():
        # v1 backups have no filesystem payload.
        return []
    value = json.loads(manifest.read_text())
    if value.get('version') != 1 or not isinstance(value.get('included'), list):
        raise ValueError('Invalid persistent-files manifest')
    included = value['included']
    if len(set(included)) != len(included) or any(key not in specs for key in included):
        raise ValueError('Unknown or duplicate persistent-files entry')
    for key in included:
        _, relative, kind = specs[key]
        source = archive / relative
        check_tree(source)
        if (kind == 'file' and not source.is_file()) or (kind == 'directory' and not source.is_dir()):
            raise ValueError(f'Invalid persistent payload: {key}')
    return included


def run(args):
    archive = Path(args.archive)
    specs = entries(args.config, args.app_root)
    if args.operation == 'backup':
        included = []
        for key, (source, relative, kind) in specs.items():
            try:
                mode = source.lstat().st_mode
            except FileNotFoundError:
                continue
            except PermissionError:
                # Credentials may live in a service-only directory. Distinguish
                # missing files from unreadable ones without silently omitting them.
                probe = "import os,sys;\ntry: print(os.lstat(sys.argv[1]).st_mode)\nexcept FileNotFoundError: print('absent')"
                result = subprocess.run(['sudo', '-n', 'python3', '-c', probe, str(source)], capture_output=True, text=True, check=True).stdout.strip()
                if result == 'absent':
                    continue
                mode = int(result)
            if (kind == 'file' and not stat.S_ISREG(mode)) or (kind == 'directory' and not stat.S_ISDIR(mode)):
                raise ValueError(f'Unsupported persistent file type: {source}')
            if kind == 'directory':
                check_tree(source)
            print(f'Backup {key}: {source} -> {relative}')
            included.append(key)
            if not args.dry_run:
                (copy_tree if kind == 'directory' else copy_file)(source, archive / relative)
        if not args.dry_run:
            manifest = archive / 'metadata/persistent-files.json'
            manifest.parent.mkdir(parents=True, exist_ok=True)
            manifest.write_text(json.dumps({'version': 1, 'included': included}) + '\n')
        return
    included = payload(archive, specs)
    # Validate destinations before stopping the service or modifying any file.
    for key in included:
        target = specs[key][0]
        if target == Path(args.app_root).absolute() or target == Path('/'):
            raise ValueError(f'Unsafe restore destination: {target}')
        for component in [target, *target.parents]:
            if component.is_symlink():
                raise ValueError(f'Symlink restore destination: {component}')
        if target.exists():
            check_tree(target)
            kind = specs[key][2]
            if (kind == 'file' and not target.is_file()) or (kind == 'directory' and not target.is_dir()):
                raise ValueError(f'Invalid restore destination type: {target}')
    if args.operation == 'validate':
        return
    owner = pwd.getpwnam(args.owner) if not args.dry_run else None
    for key in included:
        target, relative, kind = specs[key]
        print(f'Restore {key}: {relative} -> {target}')
        if args.dry_run:
            continue
        missing_parents = []
        parent = target.parent
        while not parent.exists():
            missing_parents.append(parent)
            parent = parent.parent
        if kind == 'directory' and target.exists():
            shutil.rmtree(target)
        (copy_tree if kind == 'directory' else copy_file)(archive / relative, target)
        paths = [target, *target.rglob('*')] if kind == 'directory' else [target]
        for path in paths:
            os.chown(path, owner.pw_uid, owner.pw_gid)
            path.chmod(0o750 if path.is_dir() else 0o600)
        # Ensure newly created parent directories are usable by the service.
        for parent in missing_parents:
            os.chown(parent, owner.pw_uid, owner.pw_gid)
            parent.chmod(0o750)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['backup', 'validate', 'restore'])
    parser.add_argument('--config', required=True)
    parser.add_argument('--app-root', required=True)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--owner', default='gameclubbot')
    parser.add_argument('--dry-run', action='store_true')
    run(parser.parse_args())
