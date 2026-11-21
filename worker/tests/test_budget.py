import pytest

from rpg_worker.budget import Budget, BudgetExceeded


def test_counts_persist_and_cap_is_hard(tmp_path):
    f = tmp_path / "b.json"
    b = Budget(f, max_downloads=3)
    for _ in range(3):
        b.reserve_download()
    b.record_api_call()
    with pytest.raises(BudgetExceeded):
        b.reserve_download()
    again = Budget(f, max_downloads=3)  # a new process sees the same totals
    assert (again.downloads, again.api_calls) == (3, 1)
    with pytest.raises(BudgetExceeded):
        again.reserve_download()
    assert again.downloads == 3  # a refused download is not counted


def test_default_cap_is_1000(tmp_path):
    assert Budget(tmp_path / "x.json").max_downloads == 1000


def test_file_holds_only_counts(tmp_path):
    f = tmp_path / "b.json"
    Budget(f).record_api_call()
    assert set(__import__("json").loads(f.read_text())) == {"downloads", "api_calls"}
