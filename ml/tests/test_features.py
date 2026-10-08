import io

import pandas as pd
import pytest

from triagex_ml.features import (
    FEATURES_APP,
    FEATURES_PRIORITY,
    app_payload_to_frame,
    build_incident_table,
    load_events,
    time_split,
)

HEADER = (
    "number,incident_state,active,reassignment_count,reopen_count,sys_mod_count,made_sla,caller_id,opened_by,"
    "opened_at,sys_created_by,sys_created_at,sys_updated_by,sys_updated_at,contact_type,location,category,"
    "subcategory,u_symptom,cmdb_ci,impact,urgency,priority,assignment_group,assigned_to,knowledge,"
    "u_priority_confirmation,notify,problem_id,rfc,vendor,caused_by,closed_code,resolved_by,resolved_at,closed_at"
)


def row(num, state, mod, sla, updated, category, opened="01/03/2016 10:00", resolved="?"):
    return (
        f"{num},{state},true,0,0,{mod},{sla},Caller 1,Opened by 1,{opened},?,?,Updated by 1,{updated},"
        f"Phone,Location 1,{category},Subcategory 1,Symptom 1,?,2 - Medium,2 - Medium,3 - Moderate,Group 1,?,"
        f"false,false,Do Not Notify,?,?,?,?,code 1,Resolved by 1,{resolved},05/03/2016 10:00"
    )


@pytest.fixture()
def events():
    lines = [
        HEADER,
        # INC1: category changes after opening (features must use the first value); breaches at the end
        row("INC1", "New", 0, "true", "01/03/2016 10:00", "Category 1"),
        row("INC1", "Active", 1, "true", "01/03/2016 11:00", "Category 9"),
        row("INC1", "Resolved", 2, "false", "02/03/2016 10:00", "Category 9", resolved="02/03/2016 10:00"),
        # INC2: rows out of order in the file; never breaches
        row("INC2", "Resolved", 3, "true", "03/03/2016 12:00", "Category 2", "03/03/2016 09:00", "03/03/2016 12:00"),
        row("INC2", "New", 0, "true", "03/03/2016 09:00", "Category 2", "03/03/2016 09:00"),
    ]
    return load_events(io.StringIO("\n".join(lines)))


def test_features_come_from_first_event_and_targets_from_last(events):
    table = build_incident_table(events).frame
    assert list(table.index) == ["INC1", "INC2"]  # sorted by opened_at
    assert table.loc["INC1", "category"] == "Category 1"  # not the later 'Category 9'
    assert table.loc["INC1", "breached"] == 1
    assert table.loc["INC2", "breached"] == 0
    assert table.loc["INC1", "resolution_hours"] == pytest.approx(24.0)
    assert table.loc["INC2", "resolution_hours"] == pytest.approx(3.0)
    assert table.loc["INC1", "impact"] == 2.0


def test_post_open_columns_are_not_features():
    for leaky in ["reassignment_count", "closed_code", "resolved_by", "made_sla", "sys_mod_count"]:
        assert leaky not in FEATURES_PRIORITY
        assert leaky not in FEATURES_APP
    assert "impact" not in FEATURES_PRIORITY and "urgency" not in FEATURES_PRIORITY


def test_time_split_is_chronological():
    frame = pd.DataFrame({"opened_at": pd.date_range("2016-01-01", periods=10, freq="D")[::-1]})
    train, test = time_split(frame, 0.2)
    assert len(train) == 8 and len(test) == 2
    assert train["opened_at"].max() < test["opened_at"].min()


def test_app_payload_mapping():
    frame = app_payload_to_frame(
        {"channel": "portal", "impact": 1, "urgency": 2, "priority": 2, "openedAt": "2026-03-07T09:30:00Z"}
    )
    assert list(frame.columns) == FEATURES_APP
    rec = frame.iloc[0]
    assert rec["contact_type"] == "Self service"
    assert rec["open_hour"] == 9 and rec["open_weekday"] == 5 and rec["open_weekend"] == 1
    assert rec["open_business_hours"] == 0
