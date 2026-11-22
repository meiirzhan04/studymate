"""Public real-student data: the UCI "Student Performance" data set (Cortez & Silva, 2008, CC BY 4.0).

1044 real students from two Portuguese secondary schools (Mathematics: 395, Portuguese: 649) with absences
and three grades on a 0-20 scale: G1, G2 (periods) and G3 (final). It is not SDU data, so it is used as a
stand-in until SDU records are available, and models trained on it are labelled "public:..." in metrics.json.

How a row becomes the model's factors (assumptions in CAPS):
  avg_grade, min_grade   mean / min of G1, G2 as a percent (grade * 5)       <- G3 is never a feature
  grade_trend            (G2 - G1) * 5, points between the two periods
  absent_hours           `absences`
  max_absence_pct        absences / TERM_HOURS * 100, capped at 100;  attendance_pct = 100 - that
  low_grade_courses      1 if the weakest grade is below 60%
  pending_hours, missed_deadlines   0: this data set has nothing like them
  is_at_risk             1 if the final grade G3 is below 12 (60%, the app's low-grade line; Portugal's pass mark is 10)
  gpa                    the SDU grade points of the final grade as a percent (G3 * 5)
"""
from __future__ import annotations

import csv
import io
import urllib.request
from pathlib import Path

import numpy as np

from .dataset import sdu_points
from .features import FEATURES

TERM_HOURS = 45.0                       # class hours of one SDU course in a term: the scale for `absences`
AT_RISK_GRADE = 12                      # a final grade below 12/20 = 60% is "at risk": the same 60% line the app uses everywhere
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "public"
FILES = {"student-mat.csv": [
    "https://archive.ics.uci.edu/static/public/320/student+performance.zip",      # official (zip with both files)
    "https://raw.githubusercontent.com/arunk13/MSDA-Assignments/master/IS607Fall2015/Assignment3/student-mat.csv",
], "student-por.csv": [
    "https://raw.githubusercontent.com/arunk13/MSDA-Assignments/master/IS607Fall2015/Assignment3/student-por.csv",
]}
EXPECTED_ROWS = {"student-mat.csv": 395, "student-por.csv": 649}                 # published sizes: a sanity check


def map_rows(rows: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """UCI rows -> (X in FEATURES order, is_at_risk, gpa)."""
    X, y, gpa = [], [], []
    for r in rows:
        try:
            g1, g2, g3, absences = float(r["G1"]), float(r["G2"]), float(r["G3"]), float(r["absences"])
        except (KeyError, ValueError):
            continue
        if not all(0 <= g <= 20 for g in (g1, g2, g3)) or absences < 0:
            continue
        absence_pct = min(100.0, absences / TERM_HOURS * 100)
        feats = {
            "attendance_pct": 100.0 - absence_pct, "max_absence_pct": absence_pct, "absent_hours": absences,
            "pending_hours": 0.0, "avg_grade": (g1 + g2) / 2 * 5, "min_grade": min(g1, g2) * 5,
            "grade_trend": (g2 - g1) * 5, "missed_deadlines": 0.0, "low_grade_courses": float(min(g1, g2) * 5 < 60),
        }
        X.append([feats[name] for name in FEATURES])
        y.append(int(g3 < AT_RISK_GRADE))
        gpa.append(float(sdu_points(np.array([g3 * 5]))[0]))
    return np.array(X), np.array(y), np.array(gpa)


def _read(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def _download(name: str) -> str:
    last = None
    for url in FILES[name]:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "StudyMate-train"}), timeout=30) as resp:
                data = resp.read()
            if url.endswith(".zip"):
                import zipfile
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    inner = next((n for n in z.namelist() if n.endswith(name)), None)
                    if inner is None and name == "student-por.csv":
                        inner = next((n for n in z.namelist() if n.endswith("student.zip")), None)
                    if inner is None:
                        continue
                    data = z.read(inner)
            return data.decode("utf-8-sig")
        except Exception as exc:                                   # try the next source
            last = exc
    raise SystemExit(f"Could not download {name}: {last}. Download it from "
                     f"https://archive.ics.uci.edu/dataset/320/student+performance and put it in {CACHE_DIR}")


def load(use_cache: bool = True) -> tuple[np.ndarray, np.ndarray, np.ndarray, int]:
    """(X, is_at_risk, gpa, students). Files are cached in backend/data/public/."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, expected in EXPECTED_ROWS.items():
        path = CACHE_DIR / name
        if not (use_cache and path.exists()):
            path.write_text(_download(name), encoding="utf-8")
        part = _read(path.read_text(encoding="utf-8-sig"))
        if len(part) != expected:
            raise SystemExit(f"{name} has {len(part)} rows, the published data set has {expected}: the file is not the original.")
        rows += part
    X, y, gpa = map_rows(rows)
    return X, y, gpa, len(rows)
