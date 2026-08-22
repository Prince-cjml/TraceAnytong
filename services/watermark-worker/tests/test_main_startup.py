from fastapi.testclient import TestClient

from app.main import app


def test_worker_app_registers_run_once_route() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert any(route.path == "/v1/worker/run-once" for route in app.routes)
