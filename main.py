from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import psycopg2

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "mvp_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "secret")
DB_PORT = os.getenv("DB_PORT", "5432")

conn = psycopg2.connect(
    host=DB_HOST,
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    port=DB_PORT
)
conn.autocommit = True

app = FastAPI(title="Auto Summaries with CCIR & Data Provenance", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

class TeamCreate(BaseModel):
    team_name: str
    echelon_level: str
    parent_team_id: Optional[int] = None

class CreateRawData(BaseModel):
    team_id: int
    content: str
    source_type: Optional[str] = "sitrep"

@app.get("/")
def root():
    return {"message": "Auto Summaries with CCIR. Use /summaries/regenerate to rebuild bullet points."}

# ----------------------------------------------------------------------------
# HELPER FUNCTIONS
# ----------------------------------------------------------------------------
def team_exists(team_id: int) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM teams WHERE team_id=%s", (team_id,))
        return bool(cur.fetchone())

def get_child_teams_map():
    """
    Return a dict of parent_team_id -> list of child_team_ids
    """
    with conn.cursor() as cur:
        cur.execute("SELECT team_id, parent_team_id FROM teams")
        rows = cur.fetchall()
    child_map = {}
    for (tid, pid) in rows:
        if pid not in child_map:
            child_map[pid] = []
        child_map[pid].append(tid)
    return child_map

def get_descendants(root_team_id: int, child_map) -> list:
    """
    BFS or DFS to get all descendants of root_team_id, including root.
    """
    stack = [root_team_id]
    visited = []
    while stack:
        current = stack.pop()
        visited.append(current)
        if current in child_map:
            stack.extend(child_map[current])
    return visited

# ----------------------------------------------------------------------------
# TEAMS
# ----------------------------------------------------------------------------
@app.post("/teams")
def create_team(t: TeamCreate):
    """
    Create a new team. 
    """
    if t.parent_team_id and not team_exists(t.parent_team_id):
        raise HTTPException(status_code=404, detail="Parent team not found")

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO teams (team_name, echelon_level, parent_team_id)
            VALUES (%s, %s, %s)
            RETURNING team_id
        """, (t.team_name, t.echelon_level, t.parent_team_id))
        new_id = cur.fetchone()[0]

    return {"team_id": new_id, "message": "Team created"}

@app.get("/teams")
def list_teams():
    with conn.cursor() as cur:
        cur.execute("""
            SELECT team_id, team_name, echelon_level, parent_team_id
            FROM teams
            ORDER BY team_id
        """)
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append({
            "team_id": r[0],
            "team_name": r[1],
            "echelon_level": r[2],
            "parent_team_id": r[3]
        })
    return result

# ----------------------------------------------------------------------------
# RAW DATA
# ----------------------------------------------------------------------------
@app.post("/raw-data")
def create_raw_data(item: CreateRawData):
    """
    Insert raw data for a team. Summaries are not auto-updated here.
    We'll rely on the user to call /summaries/regenerate afterward 
    (or you can automatically do it here if desired).
    """
    if not team_exists(item.team_id):
        raise HTTPException(status_code=404, detail="Team not found")

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO raw_data (team_id, content, source_type)
            VALUES (%s, %s, %s)
            RETURNING raw_data_id
        """, (item.team_id, item.content, item.source_type))
        new_id = cur.fetchone()[0]

    return {"raw_data_id": new_id, "message": "Raw data created. Run /summaries/regenerate to update bullet points."}

@app.get("/raw-data/{team_id}")
def list_raw_data_for_team(team_id: int):
    if not team_exists(team_id):
        raise HTTPException(status_code=404, detail="Team not found")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT raw_data_id, content, source_type, created_at
            FROM raw_data
            WHERE team_id=%s
            ORDER BY raw_data_id
        """, (team_id,))
        rows = cur.fetchall()

    return [
        {
            "raw_data_id": r[0],
            "content": r[1],
            "source_type": r[2],
            "created_at": r[3]
        }
        for r in rows
    ]

# ----------------------------------------------------------------------------
# SUMMARIES (BULLET POINTS) - Regenerate All
# ----------------------------------------------------------------------------

@app.post("/summaries/regenerate")
def regenerate_all_summaries(ccir: Optional[str] = None):
    """
    Rebuild bullet points from scratch for all teams, bottom-up.
    If ccir is provided (a simple string), only bullet points or raw data containing
    that string (case-insensitive) are included in the new summaries.
    1) Delete all bullet_points, bullet_point_sources, bullet_point_raw_refs.
    2) For each team in ascending order (i.e. from bottom up),
       gather subordinate bullet points + local raw data that match 'ccir' (if any).
       Create bullet points referencing them.
    """
    # 1) Clear all bullet points
    with conn.cursor() as cur:
        cur.execute("DELETE FROM bullet_point_raw_refs")
        cur.execute("DELETE FROM bullet_point_sources")
        cur.execute("DELETE FROM bullet_points")

    # Build child_teams map so we can find "leaf" teams easily
    child_map = get_child_teams_map()

    # We'll produce an ordering that ensures children are processed before parents
    # If a team has no children, it's a leaf => process first.
    # We'll do a topological sort. For simplicity, we can repeatedly pick teams 
    # that haven't been processed and have no unprocessed children.

    # Gather all team_ids
    with conn.cursor() as cur:
        cur.execute("SELECT team_id FROM teams")
        all_teams = [row[0] for row in cur.fetchall()]

    processed = set()
    results = []
    # We'll keep looping until we've processed all teams
    while len(processed) < len(all_teams):
        any_progress = False
        for t_id in all_teams:
            if t_id in processed:
                continue
            # see if all children are processed
            children = child_map.get(t_id, [])
            if all(c in processed for c in children):
                # we can process t_id now
                build_summary_for_team(t_id, ccir)
                processed.add(t_id)
                any_progress = True
        if not any_progress:
            # we have a cycle or something weird - shouldn't happen in a tree
            raise HTTPException(status_code=500, detail="Team hierarchy cycle detected?")

    return {"message": "All summaries regenerated", "ccir_filter": ccir}


def build_summary_for_team(team_id: int, ccir: Optional[str]):
    """
    Create new bullet points for a single team, referencing child bullet points 
    and local raw data that match 'ccir'.
    Each "fact" = 1 bullet point.
    """
    ccir_lc = ccir.lower() if ccir else None

    # 1) Gather child bullet points that match ccir
    #    i.e. bullet points from direct children
    child_map = get_child_teams_map()
    children = child_map.get(team_id, [])

    # We'll read all bullet points from the child teams
    child_bps = []
    with conn.cursor() as cur:
        if children:
            cur.execute(f"""
                SELECT bp_id, content
                FROM bullet_points
                WHERE team_id = ANY(%s)
            """, (children,))
            child_bps = cur.fetchall()  # list of (bp_id, content)

    # Filter by CCIR if needed
    if ccir_lc:
        child_bps = [ (bid, c) for (bid, c) in child_bps if ccir_lc in c.lower() ]

    # 2) Gather local raw data for this team
    with conn.cursor() as cur:
        cur.execute("""
            SELECT raw_data_id, content
            FROM raw_data
            WHERE team_id=%s
        """, (team_id,))
        local_rds = cur.fetchall()  # list of (raw_data_id, content)

    # Filter local raw data by CCIR if needed
    if ccir_lc:
        local_rds = [ (rid, c) for (rid, c) in local_rds if ccir_lc in c.lower() ]

    # 3) Now create bullet points for each subordinate bullet point or raw data
    #    Each "fact" is one new bullet point referencing that source.
    #    This approach might produce multiple bullet points for this team.

    with conn.cursor() as cur:
        # For each child bullet point
        for (child_bp_id, child_content) in child_bps:
            # Insert a bullet point referencing that child
            cur.execute("""
                INSERT INTO bullet_points (team_id, content)
                VALUES (%s, %s)
                RETURNING bp_id
            """, (team_id, child_content))
            new_bp_id = cur.fetchone()[0]

            # Link to the child bullet point
            cur.execute("""
                INSERT INTO bullet_point_sources (parent_bp_id, child_bp_id)
                VALUES (%s, %s)
            """, (new_bp_id, child_bp_id))

        # For each local raw data
        for (rd_id, rd_content) in local_rds:
            cur.execute("""
                INSERT INTO bullet_points (team_id, content)
                VALUES (%s, %s)
                RETURNING bp_id
            """, (team_id, rd_content))
            new_bp_id = cur.fetchone()[0]

            # Link to raw_data
            cur.execute("""
                INSERT INTO bullet_point_raw_refs (bp_id, raw_data_id)
                VALUES (%s, %s)
            """, (new_bp_id, rd_id))


# ----------------------------------------------------------------------------
# HIERARCHY VIEW
# ----------------------------------------------------------------------------
@app.get("/hierarchy")
def get_bullet_point_hierarchy():
    """
    Return all bullet points in a nested tree, 
    with children = bullet points from bullet_point_sources.
    """
    # gather bullet points
    bp_map = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, team_id, content, validity_status
            FROM bullet_points
        """)
        rows = cur.fetchall()
        for (bid, tid, content, status) in rows:
            bp_map[bid] = {
                "bp_id": bid,
                "team_id": tid,
                "content": content,
                "validity_status": status,
                "children": []
            }

    # gather links
    with conn.cursor() as cur:
        cur.execute("SELECT parent_bp_id, child_bp_id FROM bullet_point_sources")
        rels = cur.fetchall()

    all_children = set()
    for (p, c) in rels:
        if p in bp_map and c in bp_map:
            bp_map[p]["children"].append(c)
            all_children.add(c)

    # roots = bullet points that are not a child
    all_bids = set(bp_map.keys())
    root_ids = all_bids - all_children

    def build_tree(bid):
        node = bp_map[bid]
        child_objs = []
        for cid in node["children"]:
            child_objs.append(build_tree(cid))
        node["children"] = child_objs
        return node

    result = []
    for r in sorted(root_ids):
        result.append(build_tree(r))
    return result

# ----------------------------------------------------------------------------
# Additional: bullet point details (for provenance)
# ----------------------------------------------------------------------------
@app.get("/bullet-points/{bp_id}")
def get_bullet_point_details(bp_id: int):
    """
    Return bullet point details + references to child bullet points or raw data 
    so you can see provenance easily.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, team_id, content, validity_status, created_at
            FROM bullet_points
            WHERE bp_id=%s
        """, (bp_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bullet point not found")
        (bid, tid, content, status, ts) = row

        # child bullet points
        cur.execute("""
            SELECT child_bp_id
            FROM bullet_point_sources
            WHERE parent_bp_id=%s
        """, (bp_id,))
        child_bps = [r[0] for r in cur.fetchall()]

        # raw references
        cur.execute("""
            SELECT raw_data_id
            FROM bullet_point_raw_refs
            WHERE bp_id=%s
        """, (bp_id,))
        raw_refs = [r[0] for r in cur.fetchall()]

    return {
        "bp_id": bid,
        "team_id": tid,
        "content": content,
        "validity_status": status,
        "created_at": ts,
        "child_bullet_points": child_bps,
        "child_raw_data": raw_refs
    }


# ----------------------------------------------------------------------------
# INVALIDATION (Optional)
# ----------------------------------------------------------------------------
@app.post("/bullet-points/invalidate/{bp_id}")
def invalidate_bullet_point(bp_id: int):
    """
    Mark a bullet point invalid, recursively marking its parents invalid.
    """
    def recurse_invalidate(bid: int):
        with conn.cursor() as c1:
            c1.execute("""
                UPDATE bullet_points
                SET validity_status='invalid'
                WHERE bp_id=%s
            """, (bid,))
            # find parents
            c1.execute("SELECT parent_bp_id FROM bullet_point_sources WHERE child_bp_id=%s", (bid,))
            parents = c1.fetchall()
        for (pbid,) in parents:
            recurse_invalidate(pbid)

    with conn.cursor() as cur:
        cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id=%s", (bp_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Bullet point not found")

    recurse_invalidate(bp_id)
    return {"message": f"Bullet point {bp_id} invalidated (and parents as well)."}

