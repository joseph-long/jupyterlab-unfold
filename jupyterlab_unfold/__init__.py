from ._version import __version__
from .handlers import setup_handlers

LABEXTENSION_DEST = "jupyterlab-speedy-unfold"


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": LABEXTENSION_DEST
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "jupyterlab_unfold"
    }]


def _load_jupyter_server_extension(server_app):
    setup_handlers(server_app.web_app)
    server_app.log.info("Registered jupyterlab_unfold server extension")
