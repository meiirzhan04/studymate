"""Train the risk classifier (is_at_risk) and the GPA regressor, then save them with joblib.

    python -m app.ml.train                # 1000 synthetic rows, writes backend/models/
    python -m app.ml.train --rows 5000    # bigger dataset
Metrics (accuracy, F1, ...) go to models/metrics.json and, when configured, to MLflow/DagsHub.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split

from . import tracking
from .dataset import generate
from .features import FEATURES

MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
MODEL_PATH = MODEL_DIR / "risk_model.joblib"
METRICS_PATH = MODEL_DIR / "metrics.json"


MIN_REAL_ROWS = 200
LABEL = "is_at_risk"


def template_csv() -> str:
    """Header plus one example row: what a real data file has to look like."""
    example = {"attendance_pct": 92, "max_absence_pct": 12, "absent_hours": 5, "pending_hours": 1, "avg_grade": 74,
               "min_grade": 61, "grade_trend": -1.5, "missed_deadlines": 1, "low_grade_courses": 0, LABEL: 0, "gpa": 2.4}
    cols = [*FEATURES, LABEL, "gpa"]
    return ",".join(cols) + "\n" + ",".join(str(example[c]) for c in cols) + "\n"


def load_csv(path: str) -> tuple[np.ndarray, np.ndarray, "np.ndarray | None"]:
    """Real students, one row each: the nine feature columns, `is_at_risk` (0/1: failed a course with FX, or needed
    support) and optionally `gpa` (the final term GPA on the 4.0 scale). Rows with gaps are dropped."""
    import csv
    with open(path, newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    missing = [c for c in [*FEATURES, LABEL] if rows and c not in rows[0]]
    if not rows or missing:
        raise SystemExit(f"{path}: needs columns {', '.join([*FEATURES, LABEL])}" + (f" (missing: {', '.join(missing)})" if missing else ""))
    X, y, gpa = [], [], []
    for row in rows:
        try:
            X.append([float(row[c]) for c in FEATURES])
            label = int(float(row[LABEL]))
            if label not in (0, 1):
                raise ValueError
            y.append(label)
            gpa.append(float(row["gpa"]) if row.get("gpa") not in (None, "") else float("nan"))
        except (ValueError, TypeError):
            continue
    X, y, gpa = np.array(X), np.array(y), np.array(gpa)
    if len(y) < MIN_REAL_ROWS or len(set(y)) < 2 or min(np.bincount(y)) < 20:
        raise SystemExit(f"Not enough real data: {len(y)} usable rows, need at least {MIN_REAL_ROWS} with 20+ of each outcome.")
    return X, y, (gpa if not np.isnan(gpa).any() else None)


def train(rows: int = 1000, seed: int = 42, save: bool = True, csv_path: "str | None" = None, public: bool = False) -> dict:
    X, y, gpa = generate(rows, seed)
    source = "synthetic"
    gpa_source = "synthetic"
    if public:
        from . import public_data
        X, y, gpa, students = public_data.load()
        source, gpa_source = f"public:uci-student-performance ({students} real students)", "public"
    elif csv_path:
        X, y, real_gpa = load_csv(csv_path)
        source = f"real:{Path(csv_path).name}"
        if real_gpa is not None:
            gpa, gpa_source = real_gpa, "real"
        else:                                              # no GPA column: the GPA model stays synthetic
            _, _, gpa_syn = generate(len(y), seed)
            gpa = gpa_syn
    X_tr, X_te, y_tr, y_te, g_tr, g_te = train_test_split(X, y, gpa, test_size=0.2, random_state=seed, stratify=y)

    params = {"n_estimators": 150, "max_depth": 7, "min_samples_leaf": 3, "random_state": seed}
    forest = RandomForestClassifier(**params, class_weight="balanced").fit(X_tr, y_tr)
    scale = X_tr.std(0)
    scale[scale == 0] = 1.0                                # a factor the data never varies (e.g. no deadlines in public data)
    baseline = LogisticRegression(max_iter=2000, class_weight="balanced").fit((X_tr - X_tr.mean(0)) / scale, y_tr)
    regressor = RandomForestRegressor(n_estimators=120, max_depth=8, min_samples_leaf=3, random_state=seed).fit(X_tr, g_tr)

    pred = forest.predict(X_te)
    proba = forest.predict_proba(X_te)[:, 1]
    base_pred = baseline.predict((X_te - X_tr.mean(0)) / scale)
    metrics = {
        "data_source": source, "gpa_model_data": gpa_source,
        "accuracy": round(accuracy_score(y_te, pred), 4),
        "f1": round(f1_score(y_te, pred), 4),
        "precision": round(precision_score(y_te, pred), 4),
        "recall": round(recall_score(y_te, pred), 4),
        "roc_auc": round(roc_auc_score(y_te, proba), 4),
        "gpa_mae": round(mean_absolute_error(g_te, regressor.predict(X_te)), 4),
        "baseline_logreg_accuracy": round(accuracy_score(y_te, base_pred), 4),
        "baseline_logreg_f1": round(f1_score(y_te, base_pred), 4),
        "train_rows": int(len(X_tr)), "test_rows": int(len(X_te)), "at_risk_share": round(float(y.mean()), 3),
    }
    version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    bundle = {
        "classifier": forest, "regressor": regressor, "features": FEATURES, "version": version, "metrics": metrics,
        "background": X_tr[np.random.default_rng(seed).choice(len(X_tr), 100, replace=False)],
        "medians": np.median(X_tr, axis=0),
    }
    if save:
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        joblib.dump(bundle, MODEL_PATH, compress=3)
        METRICS_PATH.write_text(json.dumps({"version": version, "params": params, "features": FEATURES, **metrics},
                                           indent=2) + "\n")
        run_id = tracking.log_run({**params, "rows": rows, "model": "RandomForestClassifier"}, metrics,
                                  [METRICS_PATH, MODEL_PATH], run_name=f"risk-{version}")
        if run_id:
            print(f"Logged to MLflow run {run_id}")
    return bundle


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rows", type=int, default=1000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--csv", help="train on real students from this CSV instead of synthetic data")
    parser.add_argument("--public", action="store_true", help="train on the public UCI Student Performance data (1044 real students)")
    parser.add_argument("--template", action="store_true", help="print an example CSV header and exit")
    args = parser.parse_args()
    if args.template:
        print(template_csv(), end="")
        raise SystemExit(0)
    result = train(args.rows, args.seed, csv_path=args.csv, public=args.public)
    print(json.dumps(result["metrics"], indent=2))
    print(f"Saved {MODEL_PATH}")
