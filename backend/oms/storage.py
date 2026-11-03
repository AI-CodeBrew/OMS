"""Persistent storage for generated load sheets / airway bills (PrintBatch.
file).

Why not the default storage: prod's default is FileSystemStorage on the
Fly machine's own disk (config/settings/prod.py) with no volume mounted,
so every PDF saved there vanished on the next deploy or machine restart -
exactly the documents the Batch page promises to give back unchanged.
They go to a Bunny.net Storage zone instead, over Bunny's plain REST
Storage API (no new dependency).

The zone stays private as long as no Pull Zone is linked to it: documents
are only ever served through the backend's own org-scoped download
endpoint, never by a public URL.

Reads fall back to the old local disk, so a row saved before this storage
existed still downloads for as long as that machine's file survives."""

import io
import logging
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.files.base import File
from django.core.files.storage import FileSystemStorage, Storage
from django.utils.deconstruct import deconstructible

logger = logging.getLogger(__name__)


@deconstructible
class BunnyStorage(Storage):
    def __init__(self, zone=None, access_key=None, region=None):
        self.zone = zone or settings.BUNNY_STORAGE_ZONE
        self.access_key = access_key or settings.BUNNY_STORAGE_ACCESS_KEY
        # "" is Bunny's main region (Falkenstein, storage.bunnycdn.com);
        # anything else is its prefix - "sg", "ny", "uk", "la", "syd", ...
        self.region = settings.BUNNY_STORAGE_REGION if region is None else region

    # ------------------------------------------------------------ helpers --

    def _host(self):
        return f"{self.region}.storage.bunnycdn.com" if self.region else "storage.bunnycdn.com"

    @staticmethod
    def _key(name):
        # Django builds names with os.path, so on a Windows dev machine
        # they come back with backslashes - object keys are always "/".
        return name.replace("\\", "/").lstrip("/")

    def _object_url(self, name):
        return f"https://{self._host()}/{self.zone}/{quote(self._key(name))}"

    def _headers(self, **extra):
        return {"AccessKey": self.access_key, **extra}

    # ----------------------------------------------------- Storage API --

    def generate_filename(self, filename):
        return self._key(super().generate_filename(filename))

    def _save(self, name, content):
        content.seek(0)
        response = requests.put(
            self._object_url(name),
            data=content.read(),
            headers=self._headers(**{"Content-Type": "application/octet-stream"}),
            timeout=60,
        )
        response.raise_for_status()
        return self._key(name)

    def _open(self, name, mode="rb"):
        response = requests.get(self._object_url(name), headers=self._headers(), timeout=60)
        if response.ok:
            return File(io.BytesIO(response.content), name=name)
        # Saved before this storage existed - still on the machine's disk,
        # if it survived.
        local = FileSystemStorage()
        if local.exists(name):
            return local.open(name, mode)
        raise FileNotFoundError(f"{name} is not in storage")

    def delete(self, name):
        if not name:
            return
        try:
            requests.delete(self._object_url(name), headers=self._headers(), timeout=20)
        except requests.RequestException:
            logger.warning("print batch storage: failed to delete %s", name)
        FileSystemStorage().delete(name)

    def exists(self, name):
        # Upload paths carry the row's UUID (oms.models._print_batch_upload_
        # path), so a name never collides; a PUT overwrites regardless.
        return False

    def size(self, name):
        with self._open(name) as handle:
            return len(handle.read())

    def url(self, name):
        # Never public - see the module docstring.
        raise NotImplementedError("print batch files are served by the download endpoint")


def print_batch_storage():
    """PrintBatch.file's storage: Bunny when its zone and key are set,
    otherwise the plain filesystem (fine on a dev machine, NOT persistent
    on Fly). PRINT_BATCH_STORAGE=filesystem forces the filesystem."""
    if getattr(settings, "PRINT_BATCH_STORAGE", "bunny") != "filesystem":
        if settings.BUNNY_STORAGE_ZONE and settings.BUNNY_STORAGE_ACCESS_KEY:
            return BunnyStorage()
        logger.warning(
            "BUNNY_STORAGE_ZONE / BUNNY_STORAGE_ACCESS_KEY not set - generated PDFs are "
            "saved to local disk, which does not survive a Fly deploy or restart."
        )
    return FileSystemStorage()
