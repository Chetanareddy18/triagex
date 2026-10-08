"""Train and evaluate the TriageX research models on the UCI incident event log.

Tasks (one row per incident, features from the first event only):
  1. priority   -- 4-class classification, metric: macro-F1
  2. sla_breach -- binary classification (final made_sla == False), metric: ROC-AUC
  3. resolution -- regression of hours from open to resolve, metric: MAE (hours)

Each task compares a trivial baseline, logistic/ridge regression and gradient boosting
on a chronological 80/20 split. Results are written to ml/models/metrics.json and the
app-compatible models used by the API are written to ml/models/*.joblib.

Usage:
    python ml/scripts/download_data.py
    python ml/train.py [--csv data/raw/incident_event_log.csv]
"""

from __future__ import annotations

import argparse
import json
import platform
import time
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    f1_score,
    mean_absolute_error,
    median_absolute_error,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler

from triagex_ml.features import (
    EXCLUDED_COLUMNS,
    FEATURES_APP,
    FEATURES_FULL,
    FEATURES_PRIORITY,
    ORDINAL_FIELDS,
    build_incident_table,
    load_events,
    time_split,
)

SEED = 42
VALIDATION_FRACTION = 0.15
ML_DIR = Path(__file__).resolve().parent
ROOT = ML_DIR.parent
MODELS_DIR = ML_DIR / "models"
DEFAULT_CSV = ROOT / "data" / "raw" / "incident_event_log.csv"


# --------------------------------------------------------------------------- pipelines
def _split_columns(features: list[str]) -> tuple[list[str], list[str]]:
    numeric = [c for c in features if c in ORDINAL_FIELDS or c.startswith("open_")]
    categorical = [c for c in features if c not in numeric]
    return categorical, numeric


def linear_preprocessor(features: list[str]) -> ColumnTransformer:
    categorical, numeric = _split_columns(features)
    return ColumnTransformer(
        [
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
                        ("onehot", OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=10)),
                    ]
                ),
                categorical,
            ),
            ("num", Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]), numeric),
        ]
    )


def tree_preprocessor(features: list[str]) -> tuple[ColumnTransformer, list[bool]]:
    categorical, numeric = _split_columns(features)
    transformer = ColumnTransformer(
        [
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
                        (
                            "ordinal",
                            OrdinalEncoder(
                                handle_unknown="use_encoded_value",
                                unknown_value=-1,
                                min_frequency=10,
                                max_categories=200,
                            ),
                        ),
                    ]
                ),
                categorical,
            ),
            ("num", "passthrough", numeric),
        ]
    )
    mask = [True] * len(categorical) + [False] * len(numeric)
    return transformer, mask


def classifiers(features: list[str], balanced: bool) -> dict[str, Pipeline]:
    weight = "balanced" if balanced else None
    tree_pre, mask = tree_preprocessor(features)
    return {
        "majority": Pipeline([("model", DummyClassifier(strategy="most_frequent"))]),
        "logistic_regression": Pipeline(
            [
                ("pre", linear_preprocessor(features)),
                ("model", LogisticRegression(max_iter=2000, class_weight=weight, C=1.0)),
            ]
        ),
        "gradient_boosting": Pipeline(
            [
                ("pre", tree_pre),
                (
                    "model",
                    HistGradientBoostingClassifier(
                        categorical_features=mask,
                        learning_rate=0.08,
                        max_iter=400,
                        max_leaf_nodes=31,
                        l2_regularization=1.0,
                        early_stopping=True,
                        validation_fraction=0.15,
                        class_weight=weight,
                        random_state=SEED,
                    ),
                ),
            ]
        ),
    }


def regressors(features: list[str]) -> dict[str, Pipeline]:
    tree_pre, mask = tree_preprocessor(features)
    return {
        "median": Pipeline([("model", DummyRegressor(strategy="median"))]),
        "ridge_regression": Pipeline([("pre", linear_preprocessor(features)), ("model", Ridge(alpha=1.0))]),
        "gradient_boosting": Pipeline(
            [
                ("pre", tree_pre),
                (
                    "model",
                    HistGradientBoostingRegressor(
                        categorical_features=mask,
                        loss="absolute_error",
                        learning_rate=0.08,
                        max_iter=400,
                        max_leaf_nodes=31,
                        l2_regularization=1.0,
                        early_stopping=True,
                        validation_fraction=0.15,
                        random_state=SEED,
                    ),
                ),
            ]
        ),
    }


# --------------------------------------------------------------------------- tasks
def run_priority(train: pd.DataFrame, test: pd.DataFrame) -> dict:
    y_tr, y_te = train["priority_label"], test["priority_label"]
    results = {}
    for name, pipe in classifiers(FEATURES_PRIORITY, balanced=True).items():
        pipe.fit(train[FEATURES_PRIORITY], y_tr)
        pred = pipe.predict(test[FEATURES_PRIORITY])
        results[name] = {
            "macro_f1": round(float(f1_score(y_te, pred, average="macro")), 4),
            "accuracy": round(float(accuracy_score(y_te, pred)), 4),
        }
        print(f"  priority/{name}: {results[name]}")

    # Sanity check documenting why impact/urgency are excluded: the ITIL matrix
    # learned on train reproduces priority on test almost perfectly.
    matrix = train.groupby(["impact", "urgency"])["priority_label"].agg(lambda s: s.mode().iloc[0])
    lookup = test.set_index(["impact", "urgency"]).index.map(lambda k: matrix.get(k, "3 - Moderate"))
    return {
        "features": FEATURES_PRIORITY,
        "label_distribution_test": test["priority_label"].value_counts(normalize=True).round(4).to_dict(),
        "models": results,
        "itil_matrix_lookup_accuracy": round(float(accuracy_score(y_te, lookup)), 4),
    }


def run_breach(train: pd.DataFrame, test: pd.DataFrame) -> tuple[dict, dict[str, Pipeline]]:
    out: dict = {
        "positive_rate_train": round(float(train["breached"].mean()), 4),
        "positive_rate_test": round(float(test["breached"].mean()), 4),
        "feature_sets": {},
    }
    fitted: dict[str, Pipeline] = {}
    inner, val = time_split(train, test_fraction=VALIDATION_FRACTION)
    for set_name, features in (("full", FEATURES_FULL), ("app_compatible", FEATURES_APP)):
        results = {}
        val_scores = {}
        for name, pipe in classifiers(features, balanced=False).items():
            pipe.fit(inner[features], inner["breached"])
            val_scores[name] = float(roc_auc_score(val["breached"], pipe.predict_proba(val[features])[:, 1]))
        for name, pipe in classifiers(features, balanced=False).items():
            pipe.fit(train[features], train["breached"])
            proba = pipe.predict_proba(test[features])[:, 1]
            results[name] = {
                "roc_auc": round(float(roc_auc_score(test["breached"], proba)), 4),
                "brier": round(float(brier_score_loss(test["breached"], proba)), 4),
                "f1_at_0_5": round(float(f1_score(test["breached"], (proba >= 0.5).astype(int))), 4),
            }
            results[name]["validation_roc_auc"] = round(val_scores[name], 4)
            print(f"  breach[{set_name}]/{name}: {results[name]}")
            fitted[f"{set_name}/{name}"] = pipe
        selected = max(val_scores, key=val_scores.get)
        out["feature_sets"][set_name] = {"features": features, "models": results, "selected_on_validation": selected}
    return out, fitted


def run_resolution(train: pd.DataFrame, test: pd.DataFrame) -> tuple[dict, dict[str, Pipeline]]:
    tr = train.dropna(subset=["resolution_hours"])
    te = test.dropna(subset=["resolution_hours"])
    out: dict = {
        "n_train": len(tr),
        "n_test": len(te),
        "target": "hours from opened_at to resolved_at; models fit on log1p(hours)",
        "test_median_hours": round(float(te["resolution_hours"].median()), 2),
        "feature_sets": {},
    }
    fitted: dict[str, Pipeline] = {}
    inner, val = time_split(tr, test_fraction=VALIDATION_FRACTION)
    for set_name, features in (("full", FEATURES_FULL), ("app_compatible", FEATURES_APP)):
        results = {}
        val_scores = {}
        for name, pipe in regressors(features).items():
            pipe.fit(inner[features], np.log1p(inner["resolution_hours"]))
            val_pred = np.expm1(pipe.predict(val[features])).clip(min=0)
            val_scores[name] = float(mean_absolute_error(val["resolution_hours"], val_pred))
        for name, pipe in regressors(features).items():
            pipe.fit(tr[features], np.log1p(tr["resolution_hours"]))
            pred = np.expm1(pipe.predict(te[features])).clip(min=0)
            results[name] = {
                "mae_hours": round(float(mean_absolute_error(te["resolution_hours"], pred)), 2),
                "median_ae_hours": round(float(median_absolute_error(te["resolution_hours"], pred)), 2),
            }
            results[name]["validation_mae_hours"] = round(val_scores[name], 2)
            print(f"  resolution[{set_name}]/{name}: {results[name]}")
            fitted[f"{set_name}/{name}"] = pipe
        selected = min(val_scores, key=val_scores.get)
        out["feature_sets"][set_name] = {"features": features, "models": results, "selected_on_validation": selected}
    return out, fitted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()
    if not args.csv.exists():
        raise SystemExit(f"{args.csv} not found -- run: python ml/scripts/download_data.py")

    started = time.time()
    events = load_events(args.csv)
    table = build_incident_table(events).frame
    train, test = time_split(table, test_fraction=0.2)
    print(f"events={len(events):,} incidents={len(table):,} train={len(train):,} test={len(test):,}")

    print("[1/3] priority")
    priority = run_priority(train, test)
    print("[2/3] sla breach")
    breach, breach_models = run_breach(train, test)
    print("[3/3] resolution time")
    resolution, resolution_models = run_resolution(train, test)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    breach_pick = breach["feature_sets"]["app_compatible"]["selected_on_validation"]
    resolution_pick = resolution["feature_sets"]["app_compatible"]["selected_on_validation"]
    joblib.dump(breach_models[f"app_compatible/{breach_pick}"], MODELS_DIR / "breach_app.joblib", compress=3)
    joblib.dump(
        resolution_models[f"app_compatible/{resolution_pick}"], MODELS_DIR / "resolution_app.joblib", compress=3
    )

    metrics = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "dataset": {
            "name": "UCI Incident management process enriched event log (id 498)",
            "events": int(len(events)),
            "incidents": int(len(table)),
            "opened_range": [str(table["opened_at"].min()), str(table["opened_at"].max())],
        },
        "split": {
            "method": "chronological on opened_at (first 80% train, last 20% test)",
            "train": int(len(train)),
            "test": int(len(test)),
            "test_starts_at": str(test["opened_at"].min()),
        },
        "leakage_controls": {
            "feature_source": "first logged event per incident (lowest sys_mod_count)",
            "target_source": "last logged event per incident",
            "excluded_columns": EXCLUDED_COLUMNS,
        },
        "tasks": {"priority": priority, "sla_breach": breach, "resolution_time": resolution},
        "deployed_models": {
            "breach_app.joblib": f"sla_breach / app_compatible / {breach_pick}",
            "resolution_app.joblib": f"resolution_time / app_compatible / {resolution_pick}",
            "selection": "best validation score on the last 15% (chronological) of the training window",
        },
        "environment": {
            "python": platform.python_version(),
            "scikit_learn": sklearn.__version__,
            "seed": SEED,
            "train_seconds": round(time.time() - started, 1),
        },
    }
    (MODELS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2, default=str))
    print(f"wrote {MODELS_DIR / 'metrics.json'} in {metrics['environment']['train_seconds']}s")


if __name__ == "__main__":
    main()
