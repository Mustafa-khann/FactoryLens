"""
Thin client for the FactoryLens analyze API.

Keeps all agent/prompt logic in the TypeScript app (one source of truth): the twin POSTs
an incident and gets back the multi-agent diagnosis. Base URL comes from $FACTORYLENS_API
(default http://localhost:3000). Proxies are bypassed for localhost so a local dev server
is reachable even when an HTTPS proxy is configured in the environment.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Optional


def _opener_for(url: str):
    host = urllib.request.urlparse(url).hostname or ""
    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()


def analyze(
    incident: dict,
    image_data_url: Optional[str] = None,
    base_url: Optional[str] = None,
    mode: str = "live",
    timeout: float = 180.0,
) -> dict:
    """POST an incident to /api/analyze and return the parsed AnalysisResponse."""
    base = (base_url or os.environ.get("FACTORYLENS_API", "http://localhost:3000")).rstrip("/")
    url = f"{base}/api/analyze"
    payload: dict = {"incident": incident, "mode": mode}
    if image_data_url:
        payload["imageDataUrl"] = image_data_url

    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    opener = _opener_for(url)
    try:
        with opener.open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
            msg = parsed.get("message") or parsed.get("error") or body
        except Exception:
            msg = body
        raise RuntimeError(f"analyze failed (HTTP {exc.code}): {msg[:400]}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"could not reach FactoryLens API at {url} ({exc.reason}). "
            f"Start the app (npm run dev) or set FACTORYLENS_API."
        ) from None


def recover(
    incident_title: str,
    diagnosis: str,
    actions: list,
    base_url: Optional[str] = None,
    mode: str = "live",
    timeout: float = 120.0,
) -> dict:
    """Ask the Recovery agent to choose one action from `actions` ([{id, description}, ...])."""
    base = (base_url or os.environ.get("FACTORYLENS_API", "http://localhost:3000")).rstrip("/")
    url = f"{base}/api/recover"
    payload = {"incidentTitle": incident_title, "diagnosis": diagnosis, "actions": actions, "mode": mode}
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with _opener_for(url).open(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        raise RuntimeError(f"recover failed (HTTP {exc.code}): {body[:300]}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"could not reach FactoryLens API at {url} ({exc.reason}).") from None
