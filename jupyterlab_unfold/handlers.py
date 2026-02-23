import os
import time
import orjson

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join


class TreeHandler(APIHandler):
    @tornado.web.authenticated
    def post(self):
        payload = self.get_json_body() or {}
        path = _normalize_api_path(str(payload.get("path", "")))
        open_paths = _normalize_open_paths(payload.get("open_paths", []))
        update_path = _normalize_api_path(str(payload.get("update_path", "")))
        include_timings = bool(payload.get("include_timings", False))
        log_timings = bool(payload.get("log_timings", False))

        contents_manager = self.contents_manager
        if not hasattr(contents_manager, "_get_os_path"):
            self.set_status(501)
            self.set_header("Content-Type", "application/json")
            self.finish(
                _encode_json(
                    {"message": "Contents manager does not support filesystem tree endpoint"}
                )
            )
            return

        total_start = time.perf_counter()
        expanded_paths = _expanded_paths(path, open_paths, update_path)
        tree_start = time.perf_counter()
        items, listed_dirs = _collect_directory_tree(contents_manager, path, expanded_paths)
        tree_ms = (time.perf_counter() - tree_start) * 1000

        response_payload = {"items": items}
        if include_timings:
            response_payload["timings"] = {
                "tree_ms": tree_ms,
                "listed_dirs": listed_dirs,
                "item_count": len(items),
            }

        encode_start = time.perf_counter()
        encoded = _encode_json(response_payload)
        encode_ms = (time.perf_counter() - encode_start) * 1000
        total_ms = (time.perf_counter() - total_start) * 1000

        self.set_header("Content-Type", "application/json")
        self.set_header("X-Jupyterlab-Unfold-Tree-Ms", f"{tree_ms:.3f}")
        self.set_header("X-Jupyterlab-Unfold-Encode-Ms", f"{encode_ms:.3f}")
        self.set_header("X-Jupyterlab-Unfold-Total-Ms", f"{total_ms:.3f}")
        self.set_header("X-Jupyterlab-Unfold-Item-Count", str(len(items)))
        self.set_header("X-Jupyterlab-Unfold-Listed-Dirs", str(listed_dirs))

        if log_timings:
            self.log.info(
                "jupyterlab_unfold.tree path=%s items=%d dirs=%d tree_ms=%.3f encode_ms=%.3f total_ms=%.3f",
                path or "/",
                len(items),
                listed_dirs,
                tree_ms,
                encode_ms,
                total_ms,
            )

        self.finish(encoded)


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "jupyterlab-unfold", "tree")
    handlers = [(route_pattern, TreeHandler)]
    web_app.add_handlers(host_pattern, handlers)


def _normalize_api_path(value: str) -> str:
    return value.strip().strip("/")


def _normalize_open_paths(values: object) -> set[str]:
    if not isinstance(values, list):
        return set()
    normalized = set()
    for value in values:
        if isinstance(value, str):
            normalized.add(_normalize_api_path(value))
    return normalized


def _expanded_paths(root_path: str, open_paths: set[str], update_path: str) -> set[str]:
    expanded = set(open_paths)
    if root_path:
        expanded.add(root_path)
    else:
        expanded.add("")

    if update_path:
        parts = update_path.split("/")
        partial = []
        for part in parts:
            partial.append(part)
            expanded.add("/".join(partial))

    return expanded


def _collect_directory_tree(
    contents_manager, root_path: str, expanded_paths: set[str]
) -> tuple[list[dict], int]:
    flattened_items: list[dict] = []
    listed_dirs = 0

    def walk(current_path: str) -> None:
        nonlocal listed_dirs
        listed_dirs += 1
        entries = _list_directory(contents_manager, current_path)
        for entry in entries:
            flattened_items.append(entry)
            if entry["type"] == "directory" and entry["path"] in expanded_paths:
                walk(entry["path"])

    walk(root_path)
    return flattened_items, listed_dirs


def _list_directory(contents_manager, api_path: str) -> list[dict]:
    os_path = contents_manager._get_os_path(api_path)
    if not os.path.isdir(os_path):
        return []

    parent_writable = os.access(os_path, os.W_OK)
    directories: list[dict] = []
    files: list[dict] = []

    with os.scandir(os_path) as iterator:
        for entry in iterator:
            name = entry.name
            child_path = _join_api_path(api_path, name)

            if not contents_manager.allow_hidden and name.startswith("."):
                continue

            entry_type = _entry_type(entry)
            if entry_type is None:
                continue

            model = _entry_model(name, child_path, entry_type, parent_writable)
            if entry_type == "directory":
                directories.append(model)
            else:
                files.append(model)

    directories.sort(key=lambda item: item["name"])
    files.sort(key=lambda item: item["name"])
    return directories + files


def _entry_type(entry: os.DirEntry) -> str | None:
    if entry.is_dir(follow_symlinks=False):
        return "directory"
    if entry.is_file(follow_symlinks=False):
        return "file"
    return None


def _entry_model(name: str, path: str, entry_type: str, writable: bool) -> dict:
    return {
        "name": name,
        "path": path,
        "type": entry_type,
        "writable": writable,
        "created": "1970-01-01T00:00:00Z",
        "last_modified": "1970-01-01T00:00:00Z",
        "content": None,
        "format": None,
        "mimetype": None,
        "size": None
    }


def _join_api_path(parent: str, child: str) -> str:
    if not parent:
        return child
    return f"{parent}/{child}"


def _encode_json(payload: object) -> str | bytes:
    return orjson.dumps(payload)
