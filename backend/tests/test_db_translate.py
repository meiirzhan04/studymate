from app.db import Row, translate, translate_schema


def test_placeholders_and_literal_percent_signs():
    assert translate("SELECT * FROM t WHERE a = ? AND b LIKE '%@%'") == "SELECT * FROM t WHERE a = %s AND b LIKE '%%@%%'"
    assert translate("SELECT * FROM t WHERE b LIKE '%x%'", has_params=False) == "SELECT * FROM t WHERE b LIKE '%x%'"


def test_case_insensitive_lookup_uses_lower_on_both_sides():
    sql = "SELECT * FROM login_identifiers i WHERE i.identifier = ? COLLATE NOCASE"
    assert translate(sql) == "SELECT * FROM login_identifiers i WHERE lower(i.identifier) = lower(%s)"


def test_insert_or_ignore_becomes_on_conflict_do_nothing():
    assert translate("INSERT OR IGNORE INTO teacher_scope VALUES (?, ?)") == \
        "INSERT INTO teacher_scope VALUES (%s, %s) ON CONFLICT DO NOTHING"


def test_insert_or_replace_upserts_on_the_tables_primary_key():
    sql = "INSERT OR REPLACE INTO sdu_snapshots (user_id, kind, data_json, updated_at) VALUES (?, ?, ?, ?)"
    assert translate(sql) == (
        "INSERT INTO sdu_snapshots (user_id, kind, data_json, updated_at) VALUES (%s, %s, %s, %s) "
        "ON CONFLICT (user_id, kind) DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = EXCLUDED.updated_at"
    )


def test_group_concat_becomes_string_agg():
    assert translate("SELECT GROUP_CONCAT(identifier, ', ') FROM t WHERE a = ?") == \
        "SELECT STRING_AGG(identifier, ', ') FROM t WHERE a = %s"


def test_schema_uses_serial_ids_and_double_precision():
    out = translate_schema("CREATE TABLE x (id INTEGER PRIMARY KEY AUTOINCREMENT, at REAL NOT NULL, k TEXT PRIMARY KEY COLLATE NOCASE);")
    assert "SERIAL PRIMARY KEY" in out and "DOUBLE PRECISION" in out and "NOCASE" not in out
    assert "login_identifiers_lower" in out


def test_row_supports_names_positions_and_dict():
    row = Row([("id", 7), ("name", "Ann")])
    assert row["name"] == "Ann" and row[0] == 7 and dict(row) == {"id": 7, "name": "Ann"}
