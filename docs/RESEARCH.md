# TriageX research notes: predicting incident outcomes at open time

This document describes the machine-learning work behind TriageX's AI triage:
what was predicted, from which data, how leakage was controlled, what the models
achieved, and where the results stop being trustworthy. Every number below is
copied from `ml/models/metrics.json`, which `ml/train.py` regenerates.

## 1. Problem

When a ticket is opened, an on-call team wants three things as early as possible:

1. **Priority** - how severe is this? (4 classes, P1 Critical ... P4 Low)
2. **SLA-breach risk** - how likely is it that the ticket misses its SLA?
3. **Resolution time** - roughly how long will it take?

The constraint that matters is *open time*: a prediction is only useful if it uses
information that exists when the ticket is created, not facts that accumulate later.

## 2. Data

**UCI Machine Learning Repository, dataset 498: "Incident management process enriched
event log"** (Amaral, Fantinato and Peres, 2018; CC BY 4.0). An anonymised ServiceNow
event log from an IT company.

| | |
|---|---|
| Events (rows) | 141,712 |
| Incidents | 24,918 |
| Opened | 2016-02-29 to 2017-02-16 (almost all in March to May 2016) |
| Fields | 36, all categorical or timestamps; ids like `Category 55`, `Group 56` |
| Free text | none |

Download with `python ml/scripts/download_data.py` (writes `data/raw/`, which is git-ignored).

Two properties of the data shaped the method:

- **It is an event log.** Each incident appears 1-50+ times as it moves through states.
  Later rows carry the outcome (`made_sla` flips from true to false on breach; reassignment
  counts grow; closure codes appear).
- **Priority is a deterministic function of impact and urgency.** A matrix learned on the
  training window reproduces priority on the test window with **100.0%** accuracy
  (`itil_matrix_lookup_accuracy = 1.0`). It is the standard ITIL matrix:
  sum of levels 2 -> P1, 3 -> P2, 4 -> P3, 5-6 -> P4.

## 3. Method

### 3.1 One row per incident

`ml/triagex_ml/features.py` sorts events by `(number, sys_mod_count, sys_updated_at)` and
builds one row per incident:

- **Features from the first logged event only** (lowest `sys_mod_count`).
- **Targets from the last logged event**:
  - `breached = not made_sla` on the final event;
  - `resolution_hours = resolved_at - opened_at` (incidents with no `resolved_at` are
    dropped for this task only).

### 3.2 Leakage controls

| Control | Why |
|---|---|
| Features only from the first event | `category`, `assignment_group` and others change later (category changes for 4.8% of incidents, assignment group for 38%). Using the last value leaks triage decisions. |
| Explicit exclusion list (24 columns) | e.g. `reassignment_count`, `reopen_count`, `sys_mod_count`, `closed_code`, `resolved_by`, `assigned_to`, `knowledge`, `u_priority_confirmation`, `problem_id`, `rfc`. The full list with reasons is in `metrics.json -> leakage_controls`. |
| `caller_id` excluded | 5,244 distinct ids; an identity proxy that would not generalise. |
| Impact and urgency excluded **from the priority task** | They define priority exactly; including them turns the task into a lookup table. |
| Chronological split | Train on the first 80% of incidents by `opened_at` (19,934), test on the last 20% (4,984, from 2016-05-11). No random shuffling across time. |
| Model selection on a validation slice | The deployed model per task is chosen on the last 15% (chronological) of the *training* window, never on the test set. |

Feature sets:

- `FEATURES_PRIORITY`: contact type, location, category, subcategory, symptom, assignment
  group, opened-by, plus open hour / weekday / weekend / business-hours flags.
- `FEATURES_FULL` (breach and resolution): the above plus impact, urgency, priority.
- `FEATURES_APP` (**app-compatible**): contact type, impact, urgency, priority and the four
  time features - the only fields TriageX collects with the same meaning (see section 6).

### 3.3 Models

Each task compares three models in scikit-learn pipelines (seed 42):

| Role | Classification | Regression |
|---|---|---|
| Trivial baseline | majority class | median |
| Linear baseline | logistic regression on one-hot features (rare levels pooled, `min_frequency=10`) | ridge regression |
| Main model | histogram gradient boosting with native categorical splits (`max_categories=200`, early stopping) | same, absolute-error loss |

Priority models use balanced class weights (P3 is 95.5% of the test set). Resolution
models are fit on `log1p(hours)` and evaluated on hours.

## 4. Results (test window, 4,984 incidents)

### 4.1 Priority classification - macro-F1 (impact and urgency excluded)

| Model | Macro-F1 | Accuracy |
|---|---:|---:|
| Majority class | 0.244 | 0.955 |
| Logistic regression | 0.327 | 0.732 |
| **Gradient boosting** | **0.378** | 0.831 |

Accuracy is the wrong headline here: always predicting P3 scores 95.5%. Gradient boosting
improves macro-F1 by 0.13 over the trivial baseline, i.e. it finds some signal for the
rare P1/P2/P4 classes from category, symptom, group and timing, but it is far from
reliable on its own.

### 4.2 SLA-breach prediction - ROC-AUC

Breach rate: 40.0% in the training window, 23.0% in the test window.

| Feature set | Model | ROC-AUC | Brier | F1 @ 0.5 |
|---|---|---:|---:|---:|
| Full open-time | Majority | 0.500 | 0.230 | 0.000 |
| Full open-time | Logistic regression | 0.780 | 0.159 | 0.487 |
| Full open-time | **Gradient boosting** | **0.786** | **0.155** | **0.502** |
| App-compatible | Majority | 0.500 | 0.230 | 0.000 |
| App-compatible | Logistic regression | 0.608 | 0.200 | 0.218 |
| App-compatible | **Gradient boosting** (deployed) | **0.615** | **0.198** | 0.146 |

With the full open-time features, breach risk is predictable to a useful degree
(AUC 0.79). Restricted to the fields the app shares with the dataset, the signal drops to
AUC 0.62: most of the information sits in the anonymised category, symptom and
assignment-group ids, which have no counterpart in TriageX.

### 4.3 Resolution time - MAE in hours

Resolved test incidents: 4,816; median resolution time 3.2 h; heavy right tail.

| Feature set | Model | MAE (h) | Median AE (h) |
|---|---|---:|---:|
| Full open-time | Median | 137.1 | 25.0 |
| Full open-time | Ridge regression | 126.4 | 17.3 |
| Full open-time | **Gradient boosting** | **125.3** | 18.7 |
| App-compatible | Median | 137.1 | 25.0 |
| App-compatible | **Ridge regression** (deployed) | **136.0** | 21.8 |
| App-compatible | Gradient boosting | 141.1 | 27.4 |

Resolution time is the weakest task. The best model cuts MAE by about 9% versus the
median; with app-compatible features the gain is under 1%, and gradient boosting is worse
than the baseline. The validation-based selection correctly picked ridge regression for
deployment. TriageX shows this value as "typical resolution", a rough reference, not an ETA.

## 5. Limitations

- **Distribution shift and censoring.** The test window has a much lower breach rate
  (23% vs 40%) and a much shorter median resolution time than the training window.
  Part of this is genuine drift; part is right-censoring: incidents opened near the end
  of the log that were still unresolved are dropped from the resolution task, which
  favours short tickets. Metrics on the test window are therefore optimistic for
  resolution time and the breach base rate is not stable over time.
- **Anonymised categories.** The dataset's categories, groups and symptoms are opaque ids.
  The models cannot be mapped to TriageX's own categories, so the deployed models use the
  small app-compatible feature set and are correspondingly weaker.
- **Different SLA regime.** In this dataset almost every P1/P2 ticket breaches (over 98%
  of P1 and P2 incidents end with `made_sla = false`). The deployed breach model has learned
  that, so TriageX reports high breach risk for P1/P2 tickets. It is a relative signal
  from another organisation's process, not a calibrated probability for yours.
- **Timezone.** The dataset's timestamps are local time of an unknown timezone; the app
  sends UTC. Time-of-day features are only approximately aligned.
- **No free text.** The dataset cannot evaluate text understanding. See section 6.
- **Single split.** Results come from one chronological split with a fixed seed; no
  confidence intervals were computed.

## 6. How the research maps onto the app

| App signal | Source | Evidence |
|---|---|---|
| SLA-breach risk % | `breach_app.joblib` (gradient boosting, app-compatible features) | Section 4.2: AUC 0.615 |
| Typical resolution time | `resolution_app.joblib` (ridge, app-compatible features) | Section 4.3: MAE 136.0 h vs 137.1 h baseline |
| Suggested priority | Blend of (a) the ITIL impact x urgency matrix (the rule the dataset itself follows, section 2), (b) a similarity-weighted vote of the k most similar past TriageX incidents that an agent has worked, (c) a severity keyword lexicon | Not evaluated on real data: TriageX has no labelled real-world text corpus. The trained priority model (section 4.1) is research-only because its strongest inputs do not exist in the app. |
| Suggested category | Similar-incident vote + keyword classifier | Not evaluated on real data (same reason). |
| Similar incidents | Cosine similarity over sentence embeddings (`all-MiniLM-L6-v2`, 384-d) of title + description, stored in MongoDB; falls back to a stateless hashing embedder and then to MongoDB text search | Qualitative. |

Field mapping used by `app_payload_to_frame`:

| TriageX | UCI field | Note |
|---|---|---|
| `channel = phone / email / portal / monitoring` | `contact_type = Phone / Email / Self service / Direct opening` | `monitoring -> Direct opening` is an approximation |
| `impact`, `urgency` (1-3) | `impact`, `urgency` (`1 - High` ... `3 - Low`) | same scale |
| `priority` (1-4) | `priority` (`1 - Critical` ... `4 - Low`) | same scale |
| creation time | `opened_at` hour / weekday | UTC vs unknown local time |
| `category` | `category` | **not mappable** (anonymised ids) |

The "AI agreement" figure on the dashboard (share of resolved tickets whose final priority
equals the AI suggestion) is computed on whatever data is in the database. On the seeded
demo workspace that data is synthetic, so the number demonstrates the metric, not model
quality.

## 7. Reproducing

```bash
python -m venv .venv && . .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r ml/requirements-dev.txt
python ml/scripts/download_data.py
cd ml && python train.py                          # ~10 s on a laptop CPU
pytest -q
```

`train.py` rewrites `ml/models/metrics.json` and the two deployed `.joblib` models.
Environment of the committed run: Python 3.12.7, scikit-learn 1.9.1, seed 42.

## References

- C. Amaral, M. Fantinato, S. Peres. *Incident management process enriched event log*.
  UCI Machine Learning Repository, 2018. https://archive.ics.uci.edu/dataset/498/incident+management+process+enriched+event+log
- N. Reimers, I. Gurevych. *Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks*. EMNLP 2019.
