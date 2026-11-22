"""Synthetic training data built from SDU's rules (used while no real historical data exists).

Rules encoded here (the same ones the app teaches in the Monitoring tab):
  * absence >= 30% of a course's hours (attendance < 70%) -> FX, so the student is at risk
  * every missed deadline pulls the GPA down; a course lost to FX counts as a failed course
  * "Not submitted" hours are not absences yet, but they raise the risk because teachers may
    convert them into absences
  * weak and falling grades raise the risk
Labels carry some noise, so the model has to learn the pattern instead of memorising a threshold.
"""
from __future__ import annotations

import numpy as np

from ..academics import SDU_SCALE
from .features import ABSENCE_LIMIT_PCT, FEATURES


def sdu_points(percent: np.ndarray) -> np.ndarray:
    """Official SDU grade points for percent scores (same scale as the transcript)."""
    return np.select([percent >= minimum for minimum, _l, _p in SDU_SCALE], [p for _m, _l, p in SDU_SCALE], 0.0)


def generate(n: int = 1000, seed: int = 42) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Returns (X, is_at_risk, gpa) with `n` rows; columns follow features.FEATURES."""
    rng = np.random.default_rng(seed)
    # Most students attend well; a tail does not
    absence = np.clip(rng.beta(1.4, 9.0, n) * 100, 0, 60)                  # worst course absence %
    mean_absence = absence * rng.uniform(0.35, 0.85, n)
    attendance = np.clip(100 - mean_absence, 40, 100)
    hours = rng.integers(30, 46, n)
    absent_hours = np.round(absence / 100 * hours * rng.uniform(1.0, 2.6, n))
    pending = np.where(rng.random(n) < 0.45, rng.poisson(1.6, n), 0).astype(float)
    avg_grade = np.clip(rng.normal(74, 13, n) - 0.15 * absence, 20, 100)
    min_grade = np.clip(avg_grade - np.abs(rng.normal(9, 7, n)), 0, 100)
    trend = np.clip(rng.normal(0.0, 3.5, n), -12, 12)
    missed = np.where(rng.random(n) < 0.35, rng.poisson(1.8, n), 0).astype(float)
    low_courses = np.clip(np.round((60 - min_grade) / 12 + rng.normal(0, 0.3, n)), 0, 5)
    low_courses[min_grade >= 60] = 0

    X = np.column_stack([attendance, absence, absent_hours, pending, avg_grade, min_grade, trend, missed, low_courses])
    assert X.shape[1] == len(FEATURES)

    gpa = sdu_points(avg_grade) - 0.14 * missed - 0.03 * np.maximum(0, absence - 10) - 0.9 * (absence >= ABSENCE_LIMIT_PCT) \
        + 0.03 * trend - 0.04 * pending + rng.normal(0, 0.12, n)
    gpa = np.clip(gpa, 0.0, 4.0)

    score = (0.09 * (absence - 18) + 0.28 * pending + 0.45 * missed + 0.55 * low_courses
             - 0.05 * (avg_grade - 70) - 0.12 * trend)
    probability = 1 / (1 + np.exp(-2.6 * (score - 0.4)))   # steep: rules decide, noise only at the margin
    risk = (rng.random(n) < probability).astype(int)
    risk[absence >= ABSENCE_LIMIT_PCT] = 1                                  # FX: always at risk
    risk[(avg_grade < 45) & (missed >= 1)] = 1
    risk[(absence < 8) & (missed == 0) & (min_grade >= 70) & (pending <= 1)] = 0   # clearly fine
    return X, risk, np.round(gpa, 2)
