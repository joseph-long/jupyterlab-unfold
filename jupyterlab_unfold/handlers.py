import json
import os

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

        contents_manager = self.contents_manager
        if not hasattr(contents_manager, "_get_os_path"):
            self.set_status(501)
            self.finish(
                json.dumps(
                    {"message": "Contents manager does not support filesystem tree endpoint"}
                )
            )
            return

        expanded_paths = _expanded_paths(path, open_paths, update_path)
        items = _collect_directory_tree(contents_manager, path, expanded_paths)
        self.finish(json.dumps({"items": items}))


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
) -> list[dict]:
    queue = [root_path]
    flattened_items: list[dict] = []

    while queue:
        current_path = queue.pop(0)
        entries = _list_directory(contents_manager, current_path)
        flattened_items.extend(entries)

        for entry in entries:
            if entry["type"] == "directory" and entry["path"] in expanded_paths:
                queue.append(entry["path"])

    return flattened_items


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
