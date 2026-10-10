import time

from app.cache import FileCache


def test_cache_roundtrip_and_ttl(tmp_path, monkeypatch):
    c = FileCache(tmp_path)
    assert c.get("k", 60) is None
    c.set("k", {"a": [1, 2]})
    value, stored = c.get("k", 60)
    assert value == {"a": [1, 2]}
    now = time.time()
    monkeypatch.setattr(time, "time", lambda: now + 120)
    assert c.get("k", 60) is None
