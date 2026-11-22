"""Load the trained model, score a student and explain the score with SHAP."""
from __future__ import annotations

import threading
from typing import Optional

import numpy as np

from .features import FEATURES, LABELS, clamp, complete, describe, describe_helping, risk_level, summarize, vector

_lock = threading.Lock()
_bundle: Optional[dict] = None
_explainer = None


def load(force: bool = False) -> dict:
    """The saved model; trained on the spot (about a second) if the file is missing or unreadable."""
    global _bundle, _explainer
    with _lock:
        if _bundle is not None and not force:
            return _bundle
        import joblib
        from . import train as train_mod
        try:
            _bundle = joblib.load(train_mod.MODEL_PATH)
            if _bundle.get("features") != FEATURES:
                raise ValueError("feature list changed")
        except Exception:                                  # missing file, other scikit-learn version, new features
            _bundle = train_mod.train()
        _explainer = None
        return _bundle


def _shap_values(x: np.ndarray) -> Optional[np.ndarray]:
    """SHAP contribution of each feature to P(at risk), or None when SHAP is unavailable."""
    global _explainer
    try:
        import shap
        bundle = load()
        if _explainer is None:
            _explainer = shap.TreeExplainer(bundle["classifier"])
        values = _explainer.shap_values(x)
        if isinstance(values, list):                       # older shap: one array per class
            values = values[1]
        values = np.asarray(values)
        if values.ndim == 3:                               # newer shap: (rows, features, classes)
            values = values[:, :, 1]
        return values[0]
    except Exception:
        return None


def _occlusion(x: np.ndarray) -> np.ndarray:
    """Fallback explanation: how much the risk drops when one feature is set to the typical value."""
    bundle = load()
    clf, medians = bundle["classifier"], bundle["medians"]
    base = clf.predict_proba(x)[0, 1]
    out = np.zeros(x.shape[1])
    for i in range(x.shape[1]):
        probe = x.copy()
        probe[0, i] = medians[i]
        out[i] = base - clf.predict_proba(probe)[0, 1]
    return out


MIN_IMPACT = 0.01                       # a factor must move the risk by 1 point to be named
NEUTRAL = {"attendance_pct": 100.0, "max_absence_pct": 0.0, "absent_hours": 0.0, "pending_hours": 0.0,
           "missed_deadlines": 0.0, "grade_trend": 0.0}


def _gpa(bundle: dict, features: dict) -> tuple[float, str]:
    """Predicted GPA. With the student's real current GPA known ("current_gpa"), start from it and let the model
    only add the effect of risk factors (absences, "Not submitted" hours, missed deadlines, trend): the model's
    own estimate of the same grades without those factors is subtracted, so good attendance neither lowers nor
    inflates the GPA. Without it, the model's estimate is used as is."""
    full = complete(features)
    raw = float(bundle["regressor"].predict(np.array([vector(full)]))[0])
    anchor = features.get("current_gpa")
    if isinstance(anchor, (int, float)) and anchor == anchor:
        neutral = float(bundle["regressor"].predict(np.array([vector({**full, **NEUTRAL})]))[0])
        return clamp(float(anchor) + min(0.0, raw - neutral), 0.0, 4.0), "current"      # risks only ever lower it
    return clamp(raw, 0.0, 4.0), "model"


def predict(features: dict, top: int = 3) -> dict:
    """{risk, risk_percent, level, predicted_gpa, reasons[top], model_version, explainer}."""
    bundle = load()
    full = complete(features)
    x = np.array([vector(full)])
    risk = float(bundle["classifier"].predict_proba(x)[0, 1])
    gpa, gpa_basis = _gpa(bundle, features)

    contributions = _shap_values(x)
    explainer = "shap"
    if contributions is None:
        contributions, explainer = _occlusion(x), "occlusion"
    order = np.argsort(contributions)[::-1]
    reasons = []
    for i in order:
        name = FEATURES[i]
        if contributions[i] <= MIN_IMPACT or len(reasons) >= top or (name == "grade_trend" and full[name] >= 0):
            continue                                        # too small to matter, or a rising trend is never a reason
        reasons.append({
            "feature": name, "label": LABELS[name], "value": round(full[name], 2),
            "impact": round(float(contributions[i]) * 100, 1),          # percentage points of risk
            "text": describe(name, full[name], True),
        })
    helping = []
    for i in order[::-1]:                                   # most risk-lowering first
        name = FEATURES[i]
        if contributions[i] >= -MIN_IMPACT or len(helping) >= top or (name == "grade_trend" and full[name] < 0):
            continue
        helping.append({"feature": name, "label": LABELS[name], "value": round(full[name], 2),
                        "impact": round(float(contributions[i]) * 100, 1), "text": describe_helping(name, full[name])})
    level = risk_level(risk)
    return {"risk": round(risk, 4), "risk_percent": round(risk * 100), "level": level,
            "summary": summarize(round(risk * 100), level, reasons, helping),
            "predicted_gpa": round(gpa, 2), "gpa_basis": gpa_basis, "reasons": reasons, "helping": helping,
            "model_version": bundle["version"], "explainer": explainer}


def predict_many(rows: list[dict]) -> list[tuple[float, float]]:
    """(risk, predicted_gpa) for many feature dicts at once, e.g. for the simulation curve.

    Fully batched: one classifier call and two regressor calls for all rows, same numbers as predict()."""
    if not rows:
        return []
    bundle = load()
    full = [complete(r) for r in rows]
    X = np.array([vector(f) for f in full])
    risks = bundle["classifier"].predict_proba(X)[:, 1]
    raw = bundle["regressor"].predict(X)
    anchored = [i for i, r in enumerate(rows) if isinstance(r.get("current_gpa"), (int, float)) and r["current_gpa"] == r["current_gpa"]]
    gpas = np.clip(raw, 0.0, 4.0)
    if anchored:
        neutral = np.array([vector({**full[i], **NEUTRAL}) for i in anchored])
        base = bundle["regressor"].predict(neutral)
        for k, i in enumerate(anchored):
            gpas[i] = clamp(float(rows[i]["current_gpa"]) + min(0.0, float(raw[i] - base[k])), 0.0, 4.0)
    return [(float(a), float(b)) for a, b in zip(risks, gpas)]


def info() -> dict:
    bundle = load()
    return {"version": bundle["version"], "features": FEATURES, "metrics": bundle["metrics"]}
