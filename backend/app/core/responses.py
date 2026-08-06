from flask import jsonify


def success(data=None, status=200, **extra):
    payload = {"success": True, "error": None, "code": None}
    if data is not None:
        if isinstance(data, dict):
            payload.update(data)
        else:
            payload["data"] = data
    payload.update(extra)
    return jsonify(payload), status


def error(message, code, status=400, **extra):
    payload = {
        "success": False,
        "error": message,
        "code": code,
    }
    payload.update(extra)
    return jsonify(payload), status
