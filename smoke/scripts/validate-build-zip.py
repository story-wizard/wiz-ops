"""Validate ZIP paths, types, expansion and symlink chains before native extraction."""
import posixpath as p
import stat
import sys
import unicodedata

def key(value):
    return unicodedata.normalize("NFD", value).casefold()
import zipfile
import zlib

with zipfile.ZipFile(sys.argv[1]) as archive:
    entries = archive.infolist()
    if len(entries) > 150000 or sum(e.file_size for e in entries) > 20 * 1024**3:
        raise ValueError('Archive exceeds extraction limits')
    links, seen, expanded = {}, set(), 0
    # Inspect the entire compressed stream, independent of the advertised file size.
    # ZipExtFile may stop at that size and miss a forged trailing payload.
    for entry in entries:
        if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise ValueError('Unsupported ZIP compression')
        with archive.open(entry):
            offset = archive.fp.tell()  # open validates the local header and overlap
        inflater = zlib.decompressobj(-15) if entry.compress_type == zipfile.ZIP_DEFLATED else None
        actual, crc = 0, 0
        with open(sys.argv[1], 'rb') as raw:
            raw.seek(offset)
            remaining = entry.compress_size
            while remaining:
                data = raw.read(min(1024**2, remaining))
                if not data:
                    raise ValueError('Truncated ZIP payload')
                remaining -= len(data)
                while data:
                    output = inflater.decompress(data, 1024**2) if inflater else data
                    data = inflater.unconsumed_tail if inflater else b''
                    actual += len(output)
                    expanded += len(output)
                    if expanded > 20 * 1024**3 or actual > entry.file_size:
                        raise ValueError('Archive exceeds extraction limits or declared size')
                    crc = zlib.crc32(output, crc)
                if inflater and inflater.unused_data:
                    raise ValueError('Trailing compressed ZIP payload')
        if inflater and not inflater.eof or actual != entry.file_size or crc != entry.CRC:
            raise ValueError('ZIP payload differs from its declared size or checksum')
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
