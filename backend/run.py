#!/usr/bin/env python
"""Convenience entrypoint: after activating .venv, `python run.py` starts
the Django dev server on port 8000 - same as
`python manage.py runserver 8000`, just shorter to type."""
import os

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
    from django.core.management import execute_from_command_line

    execute_from_command_line(["manage.py", "runserver", "8000"])
