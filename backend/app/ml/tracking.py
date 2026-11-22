"""Optional experiment tracking with MLflow, hosted for free on DagsHub.

Set these (e.g. in Render/Railway or your shell) and `python -m app.ml.train` logs the run there:
    MLFLOW_TRACKING_URI=https://dagshub.com/<user>/<repo>.mlflow
    MLFLOW_TRACKING_USERNAME=<dagshub user>
    MLFLOW_TRACKING_PASSWORD=<dagshub access token>
Without them (or without the `mlflow` package) training still works and only writes metrics.json.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


def enabled() -> bool:
    return bool(os.getenv("MLFLOW_TRACKING_URI"))


def log_run(params: dict, metrics: dict, artifacts: list[Path], run_name: Optional[str] = None) -> Optional[str]:
    """Returns the MLflow run id, or None when tracking is off or unavailable."""
    if not enabled():
        return None
    try:
        import mlflow
    except ImportError:
        print("MLFLOW_TRACKING_URI is set but mlflow is not installed: pip install -r requirements-mlops.txt")
        return None
    try:
        mlflow.set_tracking_uri(os.environ["MLFLOW_TRACKING_URI"])
        mlflow.set_experiment(os.getenv("MLFLOW_EXPERIMENT_NAME", "studymate-risk-model"))
        with mlflow.start_run(run_name=run_name) as run:
            mlflow.log_params(params)
            mlflow.log_metrics({k: float(v) for k, v in metrics.items() if isinstance(v, (int, float))})
            mlflow.set_tag("model_type", "RandomForestClassifier + RandomForestRegressor")
            for path in artifacts:   # the joblib model and metrics.json are versioned as run artifacts
                if Path(path).exists():
                    mlflow.log_artifact(str(path))
            return run.info.run_id
    except Exception as exc:                                    # tracking must never break training
        print(f"MLflow logging failed: {exc}")
        return None
