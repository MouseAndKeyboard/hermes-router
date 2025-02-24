-- 1) DROP tables in reverse dependency order

DROP TABLE IF EXISTS bullet_point_raw_refs CASCADE;
DROP TABLE IF EXISTS bullet_point_sources CASCADE;
DROP TABLE IF EXISTS bullet_points CASCADE;
DROP TABLE IF EXISTS raw_data CASCADE;
DROP TABLE IF EXISTS ccirs CASCADE;
DROP TABLE IF EXISTS teams CASCADE;

-- 2) CREATE tables again

-- teams
CREATE TABLE IF NOT EXISTS teams (
    team_id SERIAL PRIMARY KEY,
    team_name VARCHAR(100) NOT NULL,
    echelon_level VARCHAR(50) NOT NULL,
    parent_team_id INT REFERENCES teams(team_id) ON DELETE CASCADE
);

-- ccirs
CREATE TABLE IF NOT EXISTS ccirs (
    ccir_id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    keywords TEXT[],
    active BOOLEAN DEFAULT TRUE
);

-- raw_data
CREATE TABLE IF NOT EXISTS raw_data (
    raw_data_id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source_type VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- bullet_points
CREATE TABLE IF NOT EXISTS bullet_points (
    bp_id SERIAL PRIMARY KEY,
    team_id INT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
    echelon_level VARCHAR(50),
    content TEXT NOT NULL,
    validity_status VARCHAR(20) NOT NULL DEFAULT 'valid',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- bullet_point_sources (parent->child)
CREATE TABLE IF NOT EXISTS bullet_point_sources (
    parent_bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    child_bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    PRIMARY KEY (parent_bp_id, child_bp_id)
);

-- bullet_point_raw_refs
CREATE TABLE IF NOT EXISTS bullet_point_raw_refs (
    bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    raw_data_id INT NOT NULL REFERENCES raw_data(raw_data_id) ON DELETE CASCADE,
    source_type VARCHAR(50),
    PRIMARY KEY (bp_id, raw_data_id)
);

-- Done
