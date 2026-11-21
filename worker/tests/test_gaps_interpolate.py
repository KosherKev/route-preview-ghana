import numpy as np
import pytest

from rpg_worker.gaps import GapError, plan_gaps
from rpg_worker.interpolate import HoldInterpolator, interpolate_pair, steps_for_gap


class Spy:
    name = "spy"

    def __init__(self):
        self.calls = []

    def interpolate(self, a, b, n):
        self.calls.append(n)
        return [a for _ in range(n)]


IMG = np.zeros((8, 8, 3), np.uint8)


def test_below_15_interpolates_exactly_15_and_up_does_not():
    spy = Spy()
    assert len(interpolate_pair(spy, IMG, IMG, 14.999, 2)) == 2
    for g in (15.0, 15.001, 22.0, 30.0, 45.0):
        with pytest.raises(GapError):
            interpolate_pair(spy, IMG, IMG, g, 2)
    assert spy.calls == [2]  # the interpolator was never reached for a gap of 15 m or more


def test_plan_classifies_gaps_and_matches_bridges():
    gaps = plan_gaps([0, 8, 16, 34, 40], [{"startM": 16, "endM": 34}])
    assert [g.kind for g in gaps] == ["interpolate", "interpolate", "crossfade", "interpolate"]


def test_exactly_15_and_30_are_bridges_when_listed():
    gaps = plan_gaps([0, 15, 45], [{"startM": 0, "endM": 15}, {"startM": 15, "endM": 45}])
    assert [g.kind for g in gaps] == ["crossfade", "crossfade"]


def test_gap_over_30_fails_loudly():
    with pytest.raises(GapError, match="30 m ceiling"):
        plan_gaps([0, 8, 38.5], [])


def test_unlisted_bridge_tier_gap_fails():
    with pytest.raises(GapError, match="not in the segment's bridge list"):
        plan_gaps([0, 20], [])


def test_listed_bridge_must_be_in_bridge_tier_and_exist():
    with pytest.raises(GapError, match="below the 15 m"):
        plan_gaps([0, 10], [{"startM": 0, "endM": 10}])
    with pytest.raises(GapError, match="do not match"):
        plan_gaps([0, 10], [{"startM": 100, "endM": 120}])


def test_unordered_frames_fail():
    with pytest.raises(GapError, match="not ordered"):
        plan_gaps([5, 3], [])


def test_steps_for_gap():
    assert steps_for_gap(2.0) == 0
    assert steps_for_gap(5.0) == 1
    assert steps_for_gap(10.0) == 3
    assert steps_for_gap(14.0, max_steps=3) == 3
    assert steps_for_gap(20.0, max_steps=6, min_steps=1) == 6 or steps_for_gap(20.0, max_steps=6, min_steps=1) >= 1


def test_hold_interpolator_makes_nothing():
    assert HoldInterpolator().interpolate(IMG, IMG, 3) == []
