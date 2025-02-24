from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os
import psycopg2

###############################################################################
# Database Connection
###############################################################################
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

###############################################################################
# FastAPI Setup
###############################################################################
app = FastAPI(title="Bullet Point Hierarchy MVP", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local dev, open to all. Restrict in production.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

###############################################################################
# Pydantic Models
###############################################################################
class TeamCreate(BaseModel):
    team_name: str
    echelon_level: str
    parent_team_id: Optional[int] = None

class CCIRCreate(BaseModel):
    team_id: int
    description: str
    keywords: Optional[List[str]] = []
    active: bool = True

class CreateRawData(BaseModel):
    team_id: int
    content: str
    source_type: Optional[str] = "sitrep"

class CreateBulletPoint(BaseModel):
    team_id: int
    echelon_level: str
    content: str
    child_bps: Optional[List[int]] = []    # IDs of bullet points used
    child_raws: Optional[List[int]] = []   # IDs of raw_data used

class LinkPointsRequest(BaseModel):
    parent_id: int
    child_id: int

###############################################################################
# TEAM Endpoints
###############################################################################
@app.post("/teams")
def create_team(team: TeamCreate):
    """
    Create a new team with optional parent_team_id.
    """
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO teams (team_name, echelon_level, parent_team_id)
            VALUES (%s, %s, %s)
            RETURNING team_id
        """, (team.team_name, team.echelon_level, team.parent_team_id))
        new_id = cur.fetchone()[0]
    return {"team_id": new_id, "message": "Team created"}


def get_descendant_team_ids(root_team_id: int) -> List[int]:
    with conn.cursor() as cur:
        cur.execute("SELECT team_id, parent_team_id FROM teams")
        rows = cur.fetchall()
    children_map = {}
    for (tid, pid) in rows:
        if pid not in children_map:
            children_map[pid] = []
        children_map[pid].append(tid)

    visited = []
    stack = [root_team_id]
    while stack:
        current = stack.pop()
        visited.append(current)
        if current in children_map:
            stack.extend(children_map[current])
    return visited



@app.get("/bullet-points/team/{team_id}/hierarchy")
def get_team_hierarchy(team_id: int, include_subteams: bool = True):
    """
    Build a nested bullet-point hierarchy for the given team, 
    plus any descendants if 'include_subteams=true'.
    Excludes any bullet points from sibling or parent teams.
    """

    # Step 1: Gather set of valid team_ids (team_id + descendants if requested).
    team_ids = [team_id]
    if include_subteams:
        team_ids = get_descendant_team_ids(team_id)  # your helper that does BFS/DFS to find children
    
    # Step 2: Fetch bullet points belonging to those teams
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, team_id, echelon_level, content, validity_status
            FROM bullet_points
            WHERE team_id = ANY(%s)
        """, (team_ids,))
        rows = cur.fetchall()
    
    # Build a map of bullet_point_id -> details
    bp_map = {}
    for r in rows:
        (bid, tid, lvl, content, status) = r
        bp_map[bid] = {
            "bp_id": bid,
            "team_id": tid,
            "echelon_level": lvl,
            "content": content,
            "validity_status": status,
            "children": []
        }
    
    # Step 3: Fetch parent->child links, but only keep ones 
    # where both parent and child belong to the 'team_ids' set of bullet points
    with conn.cursor() as cur:
        cur.execute("""
            SELECT parent_bp_id, child_bp_id 
            FROM bullet_point_sources
        """)
        rels = cur.fetchall()
    
    # We'll keep only relationships where both parent and child are in bp_map
    all_children = set()
    for (parent, child) in rels:
        if parent in bp_map and child in bp_map:
            bp_map[parent]["children"].append(child)
            all_children.add(child)
    
    # Step 4: Identify "root" bullet points in this set 
    # (i.e., bullet points that are never a child in the filtered set)
    all_bids = set(bp_map.keys())
    root_ids = all_bids - all_children
    
    # Step 5: Build the nested structure
    def build_tree(bp_dict):
        new_children = []
        for c_id in bp_dict["children"]:
            new_children.append(build_tree(bp_map[c_id]))
        bp_dict["children"] = new_children
        return bp_dict
    
    hierarchy = [build_tree(bp_map[r]) for r in sorted(root_ids)]
    return hierarchy


@app.get("/teams")
def list_teams():
    """
    Return all teams (flat list).
    """
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

@app.get("/teams/{team_id}/subtree")
def get_team_subtree(team_id: int):
    """
    Return the specified team plus all of its descendant teams in a nested structure.
    """

    # Build up a map: team_id -> (team_name, echelon_level, parent_team_id, children=[])
    with conn.cursor() as cur:
        cur.execute("""
            SELECT team_id, team_name, echelon_level, parent_team_id
            FROM teams
        """)
        rows = cur.fetchall()

    team_map = {}
    for row in rows:
        tid, tname, lvl, pid = row
        team_map[tid] = {
            "team_id": tid,
            "team_name": tname,
            "echelon_level": lvl,
            "parent_team_id": pid,
            "children": []
        }

    # Fill children
    for t in team_map.values():
        pid = t["parent_team_id"]
        if pid and pid in team_map:
            team_map[pid]["children"].append(t["team_id"])

    # Identify the subtree from the requested team_id downward
    if team_id not in team_map:
        raise HTTPException(status_code=404, detail="Team not found")

    def build_subtree(tid):
        node = team_map[tid]
        children = node["children"]
        child_objs = [build_subtree(c) for c in children]
        return {
            "team_id": tid,
            "team_name": node["team_name"],
            "echelon_level": node["echelon_level"],
            "parent_team_id": node["parent_team_id"],
            "children": child_objs
        }

    return build_subtree(team_id)

###############################################################################
# CCIR Endpoints
###############################################################################
@app.post("/ccirs")
def create_ccir(ccir: CCIRCreate):
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO ccirs (team_id, description, keywords, active)
            VALUES (%s, %s, %s, %s)
            RETURNING ccir_id
        """, (ccir.team_id, ccir.description, ccir.keywords, ccir.active))
        new_id = cur.fetchone()[0]
    return {"ccir_id": new_id, "message": "CCIR created"}

@app.get("/ccirs/{team_id}")
def get_ccirs_for_team(team_id: int):
    """
    Return all active CCIRs for a given team.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT ccir_id, description, keywords, active
            FROM ccirs
            WHERE team_id = %s
            ORDER BY ccir_id
        """, (team_id,))
        rows = cur.fetchall()
    return [
        {
            "ccir_id": r[0],
            "description": r[1],
            "keywords": r[2],
            "active": r[3]
        }
        for r in rows
    ]

###############################################################################
# RAW DATA Endpoints
###############################################################################
@app.post("/raw-data")
def create_raw(item: CreateRawData):
    """
    Store raw SITREP (or other) text for a given team, return raw_data_id.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT team_id FROM teams WHERE team_id = %s
        """, (item.team_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Team not found")

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO raw_data (team_id, content, source_type)
            VALUES (%s, %s, %s) RETURNING raw_data_id
        """, (item.team_id, item.content, item.source_type))
        raw_id = cur.fetchone()[0]
    return {"raw_data_id": raw_id, "message": "Raw data created"}

@app.get("/raw-data/{team_id}")
def get_raw_for_team(team_id: int):
    """
    Return raw_data belonging to the given team (not including sub-teams).
    You can expand this with a recursive lookup if needed.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT raw_data_id, content, source_type, created_at
            FROM raw_data
            WHERE team_id = %s
            ORDER BY raw_data_id
        """, (team_id,))
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append({
            "raw_data_id": r[0],
            "content": r[1],
            "source_type": r[2],
            "created_at": r[3]
        })
    return result

###############################################################################
# BULLET POINT Endpoints
###############################################################################
@app.post("/bullet-points")
def create_bullet_point(bp: CreateBulletPoint):
    """
    Create a new bullet point for the specified team.
    child_bps = array of bullet point IDs that feed into this
    child_raws = array of raw_data IDs that feed into this
    """
    with conn.cursor() as cur:
        # Verify the team
        cur.execute("SELECT team_id FROM teams WHERE team_id=%s", (bp.team_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Team not found")

        # Insert the new bullet point
        cur.execute("""
            INSERT INTO bullet_points (team_id, echelon_level, content)
            VALUES (%s, %s, %s)
            RETURNING bp_id
        """, (bp.team_id, bp.echelon_level, bp.content))
        new_bp_id = cur.fetchone()[0]

        # Link child bullet points
        for child_id in bp.child_bps:
            # confirm child bullet point exists
            cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id=%s", (child_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail=f"Child bullet point {child_id} not found")

            cur.execute("""
                INSERT INTO bullet_point_sources (parent_bp_id, child_bp_id)
                VALUES (%s, %s)
            """, (new_bp_id, child_id))

        # Link raw_data
        for raw_id in bp.child_raws:
            # confirm raw_data exists
            cur.execute("SELECT raw_data_id FROM raw_data WHERE raw_data_id=%s", (raw_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail=f"Raw data {raw_id} not found")

            cur.execute("""
                INSERT INTO bullet_point_raw_refs (bp_id, raw_data_id, source_type)
                VALUES (%s, %s, %s)
            """, (new_bp_id, raw_id, "raw_source"))

    return {"bp_id": new_bp_id, "message": "Bullet point created"}

@app.get("/bullet-points/{bp_id}")
def get_bullet_point(bp_id: int):
    """
    Return bullet point data (including child IDs).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, team_id, echelon_level, content, validity_status, created_at
            FROM bullet_points
            WHERE bp_id = %s
        """, (bp_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Bullet point not found")

        cur.execute("""
            SELECT child_bp_id
            FROM bullet_point_sources
            WHERE parent_bp_id = %s
        """, (bp_id,))
        child_ids = [r[0] for r in cur.fetchall()]

        # also fetch raw_data references
        cur.execute("""
            SELECT raw_data_id
            FROM bullet_point_raw_refs
            WHERE bp_id = %s
        """, (bp_id,))
        raw_refs = [r[0] for r in cur.fetchall()]

    return {
        "bp_id": row[0],
        "team_id": row[1],
        "echelon_level": row[2],
        "content": row[3],
        "validity_status": row[4],
        "created_at": row[5],
        "child_bullet_points": child_ids,
        "child_raw_data_ids": raw_refs
    }

@app.post("/bullet-points/link")
def link_bullet_points(link_req: LinkPointsRequest):
    """
    Link child bullet point to a parent bullet point for hierarchy.
    """
    parent_id = link_req.parent_id
    child_id = link_req.child_id

    with conn.cursor() as cur:
        # Validate existence
        cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id = %s", (parent_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Parent bullet point not found")

        cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id = %s", (child_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Child bullet point not found")

        cur.execute("""
            INSERT INTO bullet_point_sources (parent_bp_id, child_bp_id)
            VALUES (%s, %s)
        """, (parent_id, child_id))

    return {"msg": f"Linked bullet point {child_id} as a child of {parent_id}"}

@app.post("/bullet-points/invalidate/{bp_id}")
def invalidate_bullet_point(bp_id: int):
    """
    Mark a bullet point invalid, recursively invalidating its parent bullet points.
    """
    def recurse_invalidate(bid: int):
        with conn.cursor() as c2:
            c2.execute("""
                UPDATE bullet_points
                SET validity_status = 'invalid'
                WHERE bp_id = %s
            """, (bid,))
        # find parents
        with conn.cursor() as c3:
            c3.execute("SELECT parent_bp_id FROM bullet_point_sources WHERE child_bp_id = %s", (bid,))
            parents = c3.fetchall()
        for p in parents:
            recurse_invalidate(p[0])

    # check if exists
    with conn.cursor() as cur:
        cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id=%s", (bp_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Bullet point not found")

    # do recursive invalidation
    recurse_invalidate(bp_id)
    return {"msg": f"Bullet point {bp_id} (and ancestors) invalidated."}

###############################################################################
# HIERARCHY Endpoint
###############################################################################
@app.get("/hierarchy")
def get_hierarchy():
    """
    Return all bullet points in a nested tree. 
    The 'root' bullet points are those that have no parent.
    """
    bp_map = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, team_id, echelon_level, content, validity_status
            FROM bullet_points
        """)
        rows = cur.fetchall()
        for r in rows:
            bid, tid, lvl, content, status = r
            bp_map[bid] = {
                "bp_id": bid,
                "team_id": tid,
                "echelon_level": lvl,
                "content": content,
                "validity_status": status,
                "children": []
            }

    # fill child lists
    with conn.cursor() as cur:
        cur.execute("SELECT parent_bp_id, child_bp_id FROM bullet_point_sources")
        rels = cur.fetchall()
        all_children = set()
        for (parent, child) in rels:
            all_children.add(child)
            bp_map[parent]["children"].append(child)

    # roots = all bullet points that are never a child
    all_bids = set(bp_map.keys())
    root_ids = all_bids - all_children

    # recursively build
    def build_tree(bp_dict):
        new_children = []
        for c_id in bp_dict["children"]:
            new_children.append(build_tree(bp_map[c_id]))
        bp_dict["children"] = new_children
        return bp_dict

    hierarchy = [build_tree(bp_map[r]) for r in sorted(root_ids)]
    return hierarchy

###############################################################################
# Bullet Points by Team (including sub-teams)
###############################################################################
@app.get("/bullet-points/team/{team_id}")
def get_bullet_points_for_team(team_id: int, include_subteams: bool = False):
    """
    Return bullet points for a given team. 
    If include_subteams=true, also gather bullet points from descendant teams.
    """
    # Validate existence
    with conn.cursor() as cur:
        cur.execute("SELECT team_id FROM teams WHERE team_id=%s", (team_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Team not found")

    team_ids = [team_id]
    if include_subteams:
        # fetch subtree
        # For simplicity, do a quick BFS/DFS in Python, or do a recursive CTE in SQL.
        team_ids = get_descendant_team_ids(team_id)

    # get bullet points
    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT bp_id, team_id, echelon_level, content, validity_status, created_at
            FROM bullet_points
            WHERE team_id IN %s
            ORDER BY bp_id
        """, (tuple(team_ids),))
        rows = cur.fetchall()

    result = []
    for r in rows:
        result.append({
            "bp_id": r[0],
            "team_id": r[1],
            "echelon_level": r[2],
            "content": r[3],
            "validity_status": r[4],
            "created_at": r[5]
        })
    return result

def get_descendant_team_ids(root_team_id: int) -> List[int]:
    """
    Simple function to get all descendant team IDs (including the root).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT team_id, parent_team_id FROM teams
        """)
        rows = cur.fetchall()

    # build adjacency list
    children_map = {}
    for (tid, pid) in rows:
        if pid not in children_map:
            children_map[pid] = []
        children_map[pid].append(tid)

    result = []
    def dfs(tid):
        result.append(tid)
        if tid in children_map:
            for c in children_map[tid]:
                dfs(c)

    dfs(root_team_id)
    return result

###############################################################################
# Root Endpoint
###############################################################################
@app.get("/")
def read_root():
    return {"message": "Bullet Point MVP with Teams and CCIR - version 3.0"}
