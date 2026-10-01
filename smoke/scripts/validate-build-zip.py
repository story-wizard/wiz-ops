"""Validate ZIP paths, types, expansion and symlink chains before native extraction."""
import posixpath as p
import stat
import sys
import unicodedata

def key(value):
    return unicodedata.normalize("NFD", value).casefold()
import zipfile

with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) > 150000 or sum(e.file_size for e in entries) > 20 * 1024**3:
        raise ValueError('Archive exceeds extraction limits')
    links, seen = {}, set()
    for entry in entries:
        name = entry.filename.rstrip('/')
        if entry.orig_filename != entry.filename or any(ord(c) < 32 for c in name) or not name or name.startswith('/') or '\\' in name or any(v in ('', '.', '..') for v in name.split('/')):
            raise ValueError('Unsafe ZIP path: ' + name)
        if key(name) in seen:
            raise ValueError('Duplicate ZIP path: ' + name)
        seen.add(key(name))
        mode = entry.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK):
            raise ValueError('Unsupported ZIP entry: ' + name)
        if stat.S_ISLNK(mode):
            if entry.file_size > 4096:
                raise ValueError('Oversized symbolic link')
            target = archive.read(entry).decode('utf-8')
            if target.startswith('/') or '\\' in target:
                raise ValueError('Unsafe symbolic link')
            links[key(name)] = target
    for entry in entries:
        parts = entry.filename.rstrip('/').split('/')
        resolved, steps = [], 0
        while parts:
            part = parts.pop(0)
            if part in ('', '.'):
                continue
            if part == '..':
                if not resolved:
                    raise ValueError('Symbolic link escapes archive')
                resolved.pop()
                continue
            resolved.append(part)
            link = links.get(key('/'.join(resolved)))
            if link is not None:
                resolved.pop()
                parts = link.split('/') + parts
                steps += 1
                if steps > 40:
                    raise ValueError('Cyclic symbolic link')
