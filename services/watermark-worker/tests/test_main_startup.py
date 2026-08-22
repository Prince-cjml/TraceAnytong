from fastapi.testclient import TestClient

from app.execution import RunOutcome
from app.main import WorkerLoopConfig, app, run_worker_loop


class FakeRunner:
    def __init__(self, outcomes: list[RunOutcome]) -> None:
        self.outcomes = outcomes
        self.run_calls = 0
        self.maintenance_calls = 0

    def maintain(self) -> dict[str, int]:
        self.maintenance_calls += 1
        return {"recovered": 0, "requeued": 0}

    def run_once(self) -> RunOutcome:
        self.run_calls += 1
        return self.outcomes.pop(0)


def test_worker_app_registers_run_once_route() -> None:
    with TestClient(app) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert any(route.path == "/v1/worker/run-once" for route in app.routes)


def test_continuous_worker_delays_idle_and_maintains_before_claiming() -> None:
    runner = FakeRunner([RunOutcome("idle")])
    delays: list[float] = []

    result = run_worker_loop(
        runner,
        WorkerLoopConfig(idle_poll_seconds=3, failure_backoff_seconds=1, max_failure_backoff_seconds=4, max_consecutive_failures=3),
        sleep=delays.append,
        should_stop=lambda: runner.run_calls >= 1,
    )

    assert result == 0
    assert delays == [3]
    assert runner.maintenance_calls == 1


def test_continuous_worker_immediately_claims_after_success_then_polls_idle() -> None:
    runner = FakeRunner([RunOutcome("succeeded", "job-one"), RunOutcome("idle")])
    delays: list[float] = []

    result = run_worker_loop(
        runner,
        WorkerLoopConfig(idle_poll_seconds=2, failure_backoff_seconds=1, max_failure_backoff_seconds=4, max_consecutive_failures=3),
        sleep=delays.append,
        should_stop=lambda: runner.run_calls >= 2,
    )

    assert result == 0
    assert runner.run_calls == 2
    assert runner.maintenance_calls == 2
    assert delays == [2]


def test_continuous_worker_backs_off_then_exits_for_repeated_failed_outcomes() -> None:
    runner = FakeRunner([RunOutcome("failed", "job-one", "PROCESSING_ERROR"), RunOutcome("failed", "job-two", "PROCESSING_ERROR")])
    delays: list[float] = []

    result = run_worker_loop(
        runner,
        WorkerLoopConfig(idle_poll_seconds=2, failure_backoff_seconds=1, max_failure_backoff_seconds=4, max_consecutive_failures=2),
        sleep=delays.append,
    )

    assert result == 1
    assert delays == [1]
    assert runner.maintenance_calls == 2


def test_lease_loss_is_not_counted_as_a_failed_job() -> None:
    runner = FakeRunner([RunOutcome("lease_lost", "job-one", "LEASE_LOST"), RunOutcome("idle")])
    delays: list[float] = []

    result = run_worker_loop(
        runner,
        WorkerLoopConfig(idle_poll_seconds=2, failure_backoff_seconds=1, max_failure_backoff_seconds=4, max_consecutive_failures=1),
        sleep=delays.append,
        should_stop=lambda: runner.run_calls >= 2,
    )

    assert result == 0
    assert delays == [2, 2]


def test_continuous_worker_handles_interrupt_during_idle_sleep() -> None:
    runner = FakeRunner([RunOutcome("idle")])

    def interrupt(_: float) -> None:
        raise KeyboardInterrupt

    result = run_worker_loop(
        runner,
        WorkerLoopConfig(idle_poll_seconds=2, failure_backoff_seconds=1, max_failure_backoff_seconds=4, max_consecutive_failures=3),
        sleep=interrupt,
    )

    assert result == 0
    assert runner.run_calls == 1
