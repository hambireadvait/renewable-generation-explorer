"""Small on-disk TTL cache for raw provider responses (gzip JSON, one file per key)."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


class FileCache:
    def __init__(self, directory: Path):
        self.directory = Path(directory)

    def _path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode()).hexdigest()
        return self.directory / digest[:2] / f"{digest}.json.gz"

    def get(self, key: str, ttl_s: int) -> tuple[Any, float] | None:
        """Return (value, stored_at_epoch) if present and fresh, else None."""
        path = self._path(key)
        try:
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                entry = json.load(fh)
        except (FileNotFoundError, OSError, ValueError):
            return None
        stored_at = entry.get("stored_at", 0)
        if time.time() - stored_at > ttl_s:
            return None
        return entry["value"], stored_at

    def set(self, key: str, value: Any) -> float:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        stored_at = time.time()
        # Write atomically so a crash never leaves a half-written entry.
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as raw, gzip.open(raw, "wt", encoding="utf-8") as fh:
                json.dump({"key": key, "stored_at": stored_at, "value": value}, fh)
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return stored_at
