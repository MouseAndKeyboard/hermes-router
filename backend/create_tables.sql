-- 1) Create raw_data table (optional but useful for storing original SITREP text)
CREATE TABLE IF NOT EXISTS raw_data (
    raw_data_id SERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2) Create main bullet_points table
--    This stores each summarized fact or bullet point, along with validity status.
CREATE TABLE IF NOT EXISTS bullet_points (
    bp_id SERIAL PRIMARY KEY,
    echelon_level VARCHAR(50),         -- e.g. "Platoon", "Company", ...
    content TEXT NOT NULL,             -- The bullet point text
    validity_status VARCHAR(20) DEFAULT 'valid',  -- valid, invalid, contested, etc.
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3) Create bullet_point_sources table
--    This manages parent-child relationships (a parent bullet point derived from child bullet points).
CREATE TABLE IF NOT EXISTS bullet_point_sources (
    parent_bp_id INT NOT NULL,
    child_bp_id INT NOT NULL,
    FOREIGN KEY (parent_bp_id) REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    FOREIGN KEY (child_bp_id) REFERENCES bullet_points(bp_id) ON DELETE CASCADE
);

-- 4) Create bullet_point_raw_refs table
--    This links a bullet point directly to the raw data it was derived from (if any).
CREATE TABLE IF NOT EXISTS bullet_point_raw_refs (
    bp_id INT NOT NULL REFERENCES bullet_points(bp_id) ON DELETE CASCADE,
    raw_data_id INT NOT NULL,
    source_type VARCHAR(50)   -- e.g. "sitrep", "transcript"
);
