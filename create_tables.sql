-- 1) Drop in reverse dependency order
DROP TABLE IF EXISTS bullet_point_raw_refs CASCADE;
DROP TABLE IF EXISTS bullet_point_sources CASCADE;
DROP TABLE IF EXISTS bullet_points CASCADE;
DROP TABLE IF EXISTS raw_data CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- 2) Create tables

CREATE TABLE teams (
    team_id SERIAL PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL,
    echelon_level VARCHAR(50) NOT NULL,
    parent_team_id INT REFERENCES teams(team_id) ON DELETE CASCADE
);

CREATE TABLE raw_data (
    raw_data_id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_type VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE bullet_points (
    bp_id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    content TEXT NOT NULL,                   -- The "fact" or statement
    validity_status VARCHAR(20) NOT NULL DEFAULT 'valid',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE bullet_point_sources (
    parent_bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    child_bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    PRIMARY KEY (parent_bp_id, child_bp_id)
);

CREATE TABLE bullet_point_raw_refs (
    bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    raw_data_id INT NOT NULL REFERENCES raw_data(raw_data_id) ON DELETE CASCADE,
    PRIMARY KEY (bp_id, raw_data_id)
);

-- Done
