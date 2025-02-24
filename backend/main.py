from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict
import os
import psycopg2

###############################################################################
# 1) Configuration & Setup
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

app = FastAPI(title="Bullet Point MVP", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For local dev, let everything in. In production, specify your domain(s).
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

###############################################################################
# 2) Pydantic Models
###############################################################################

class CreateRawData(BaseModel):
    content: str
    echelon_level: Optional[str] = "Platoon"

class LinkPointsRequest(BaseModel):
    parent_id: int
    child_id: int

###############################################################################
# 3) Existing Endpoints
#    - Create SITREP -> bullet point
#    - Link bullet points (parent/child)
#    - Get bullet point by ID
#    - Invalidate bullet point
###############################################################################

@app.post("/raw-data")
def create_raw_data(item: CreateRawData):
    """
    Store raw SITREP text, create a bullet point, and link them.
    """
    with conn.cursor() as cur:
        cur.execute("INSERT INTO raw_data (content) VALUES (%s) RETURNING raw_data_id",
                    (item.content,))
        raw_id = cur.fetchone()[0]

    summary = item.content[:100] + "..." if len(item.content) > 100 else item.content

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO bullet_points (content, echelon_level)
            VALUES (%s, %s) RETURNING bp_id
        """, (summary, item.echelon_level))
        bp_id = cur.fetchone()[0]

    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO bullet_point_raw_refs (bp_id, raw_data_id, source_type)
            VALUES (%s, %s, %s)
        """, (bp_id, raw_id, "sitrep"))

    return {"bullet_point_id": bp_id, "summary_content": summary}


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


@app.get("/bullet-points/{bp_id}")
def get_bullet_point(bp_id: int):
    """
    Return bullet point data (including child IDs).
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, echelon_level, content, validity_status
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

    return {
        "bp_id": row[0],
        "echelon_level": row[1],
        "content": row[2],
        "validity_status": row[3],
        "children": child_ids
    }


@app.post("/bullet-points/{bp_id}/invalidate")
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

    with conn.cursor() as cur:
        cur.execute("SELECT bp_id FROM bullet_points WHERE bp_id=%s", (bp_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Bullet point not found")

    recurse_invalidate(bp_id)
    return {"msg": f"Bullet point {bp_id} (and ancestors) invalidated."}

###############################################################################
# 4) New Endpoint: Get the Entire Hierarchy as a Nested JSON Tree
###############################################################################

@app.get("/hierarchy")
def get_full_hierarchy():
    """
    Returns a list of "root" bullet points, each with nested children.
    A bullet point is a "root" if it is not a child of any other bullet point.
    """

    # 1) Build a quick map of bp_id -> { bp_id, content, validity_status, children[] }
    bp_map = {}
    with conn.cursor() as cur:
        cur.execute("""
            SELECT bp_id, echelon_level, content, validity_status
            FROM bullet_points
        """)
        rows = cur.fetchall()
        for r in rows:
            bp_id = r[0]
            bp_map[bp_id] = {
                "bp_id": bp_id,
                "echelon_level": r[1],
                "content": r[2],
                "validity_status": r[3],
                "children": []
            }

    # 2) Fill children relationships
    with conn.cursor() as cur:
        cur.execute("""
            SELECT parent_bp_id, child_bp_id
            FROM bullet_point_sources
        """)
        rel_rows = cur.fetchall()
        for (parent, child) in rel_rows:
            bp_map[parent]["children"].append(child)

    # 3) Identify root bullet points (those that are never 'child_bp_id')
    all_children = set()
    for (parent, child) in rel_rows:
        all_children.add(child)

    # Root bullet points = all bp_ids - all children
    all_bp_ids = set(bp_map.keys())
    root_ids = all_bp_ids - all_children
    roots = [bp_map[rid] for rid in sorted(root_ids)]

    # 4) Recursively "expand" the children so we get nested objects
    #    We can do it on the client side or here in Python. We'll do it here for convenience.

    def build_tree(bp_dict):
        # turn each child id into a nested dict
        new_children = []
        for c_id in bp_dict["children"]:
            child_obj = bp_map[c_id]
            # recursively build
            new_children.append(build_tree(child_obj))
        # sort children if you want a stable order
        bp_dict["children"] = new_children
        return bp_dict

    # 5) Build full nested structure for each root
    hierarchy = [build_tree(r) for r in roots]
    return hierarchy

###############################################################################
# 5) Root Endpoint
###############################################################################

@app.get("/")
def read_root():
    return {"message": "Bullet Point MVP - version 2.0. See /docs or /bullet-points/hierarchy."}
