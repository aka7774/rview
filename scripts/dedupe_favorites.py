#!/usr/bin/env python3
"""Remove old favorite copies from date folders; never delete favorites.

First run with ROOT --ledger FILE, then repeat with --apply. The same TSV
records both the proposed matches and the deletion outcomes. Image bytes are
only used locally for comparison and are never printed or decoded.
"""

import argparse
import csv
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from zoneinfo import ZoneInfo

DATE = re.compile(r"\d{4}-\d{2}-\d{2}[^fg]*")
FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
FIELDS = ["source", "keep", "bytes", "head_sha256", "sha256", "status", "updated_jst"]
BLOCK = 1024 * 1024


def now():
    return datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(timespec="seconds")


def signature(st):
    return st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns


def regular(path):
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode):
        raise ValueError("not a regular file")
    return st


def digest(path, head=False):
    before = regular(path)
    h = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        if signature(os.fstat(stream.fileno())) != signature(before):
            raise ValueError("file changed before hashing")
        if head:
            h.update(stream.read(BLOCK))
        else:
            for chunk in iter(lambda: stream.read(BLOCK), b""):
                h.update(chunk)
        if signature(os.fstat(stream.fileno())) != signature(before):
            raise ValueError("file changed during hashing")
    if signature(regular(path)) != signature(before):
        raise ValueError("file changed after hashing")
    return h.hexdigest(), signature(before)


def images(directory):
    for base, dirs, files in os.walk(directory, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith("NOAI_")
                         and not (Path(base) / d).is_symlink())
        for name in sorted(files):
            path = Path(base) / name
            if path.suffix.lower() in FORMATS and not path.is_symlink():
                yield path, regular(path)


def safe_paths(root, row):
    paths = []
    for key in ("source", "keep"):
        rel = Path(row[key])
        if rel.is_absolute() or ".." in rel.parts or len(rel.parts) < 2:
            raise ValueError("invalid relative path")
        if any(part.startswith("NOAI_") for part in rel.parts):
            raise ValueError("excluded directory")
        path = root
        for part in rel.parts:
            path /= part
            if path.is_symlink():
                raise ValueError("symlink in path")
        paths.append(path)
    source, keep = paths
    source_dir, keep_dir = Path(row["source"]).parts[0], Path(row["keep"]).parts[0]
    if not DATE.fullmatch(source_dir) or keep_dir not in (source_dir + "f", source_dir + "g"):
        raise ValueError("not a date-to-favorite pair")
    if source.suffix.lower() not in FORMATS or keep.suffix.lower() not in FORMATS:
        raise ValueError("not an image")
    return source, keep


def plan(root, writer, stream):
    cache = {}
    count = total = candidates = 0

    def hashed(path, head):
        key = (path, head)
        current = signature(regular(path))
        if key not in cache or cache[key][1] != current:
            cache[key] = digest(path, head)
        return cache[key][0]

    sources = sorted(p for p in root.iterdir() if DATE.fullmatch(p.name)
                     and p.is_dir() and not p.is_symlink())
    for index, directory in enumerate(sources, 1):
        by_size = {}
        for slot in "fg":
            favorite = root / (directory.name + slot)
            if favorite.is_dir() and not favorite.is_symlink():
                for path, st in images(favorite):
                    by_size.setdefault(st.st_size, []).append(path)
        if not by_size:
            continue
        for source, st in images(directory):
            matches = by_size.get(st.st_size, [])
            if not matches:
                continue
            candidates += 1
            matches = sorted(matches, key=lambda p: (p.name != source.name, str(p)))
            source_head = hashed(source, True)
            for keep in matches:
                if hashed(keep, True) != source_head:
                    continue
                source_hash = hashed(source, False)
                if hashed(keep, False) != source_hash:
                    continue
                row = dict(zip(FIELDS, [source.relative_to(root).as_posix(),
                           keep.relative_to(root).as_posix(), st.st_size,
                           source_head, source_hash, "matched", now()]))
                safe_paths(root, row)
                writer.writerow(row)
                stream.flush()
                count += 1
                total += st.st_size
                break
        cache.clear()
        if index % 20 == 0:
            print(json.dumps({"folders_scanned": index, "matched": count,
                              "bytes": total}), flush=True)
    return {"matched": count, "bytes": total, "size_candidates": candidates}


def apply(root, rows, writer, stream):
    deleted = total = skipped = 0
    for row in rows:
        try:
            source, keep = safe_paths(root, row)
            keep_st = regular(keep)
            if not source.exists():
                if keep_st.st_size != int(row["bytes"]) or digest(keep)[0] != row["sha256"]:
                    raise ValueError("retained copy changed")
                if row["status"] != "deleted":
                    row["status"] = "source_missing"
            else:
                source_st = regular(source)
                if source_st.st_size != keep_st.st_size or source_st.st_size != int(row["bytes"]):
                    raise ValueError("size changed")
                if digest(source, True)[0] != row["head_sha256"] or digest(keep, True)[0] != row["head_sha256"]:
                    raise ValueError("head differs")
                if digest(source)[0] != row["sha256"] or digest(keep)[0] != row["sha256"]:
                    raise ValueError("content differs")
                safe_paths(root, row)
                if signature(regular(source)) != signature(source_st) or signature(regular(keep)) != signature(keep_st):
                    raise ValueError("file changed before deletion")
                source.unlink()
                deleted += 1
                total += source_st.st_size
                row["status"] = "deleted"
        except (OSError, ValueError) as exc:
            row["status"] = "kept:" + type(exc).__name__
            skipped += 1
        row["updated_jst"] = now()
        writer.writerow(row)
        stream.flush()
        os.fsync(stream.fileno())
        if (deleted + skipped) % 100 == 0:
            print(json.dumps({"deleted": deleted, "bytes": total, "skipped": skipped}), flush=True)
    return {"deleted": deleted, "bytes": total, "skipped": skipped}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve(strict=True)
    if not root.is_dir() or any(p.startswith("NOAI_") for p in root.parts):
        parser.error("invalid image root")
    rows = None
    if args.apply:
        with args.ledger.open(newline="", encoding="utf-8") as stream:
            reader = csv.DictReader(stream, delimiter="\t")
            if reader.fieldnames != FIELDS:
                parser.error("unexpected ledger columns")
            rows = list(reader)
    elif args.ledger.exists():
        parser.error("ledger exists; choose a new ledger or use --apply")
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    output = args.ledger.with_suffix(".tsv.tmp") if args.apply else args.ledger
    with output.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS, delimiter="\t")
        writer.writeheader()
        stream.flush()
        result = apply(root, rows, writer, stream) if args.apply else plan(root, writer, stream)
    if args.apply:
        output.replace(args.ledger)
    print(json.dumps(result), flush=True)
    return 1 if result.get("skipped") else 0


if __name__ == "__main__":
    raise SystemExit(main())
