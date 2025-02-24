"use client"

import { useEffect, useState } from "react";

const API_BASE = process.env.API_BASE || "http://localhost:8000";

export default function Home() {
  type BulletPoint = {  // TODO: separate into types.ts
    bp_id: number;
    content: string;
    echelon_level: string;
    validity_status: string;
    children?: BulletPoint[];
  };

  const [sitrep, setSitrep] = useState("");
  const [echelon, setEchelon] = useState("Platoon");
  const [parentId, setParentId] = useState("");
  const [childId, setChildId] = useState("");
  const [hierarchy, setHierarchy] = useState<BulletPoint[]>([]);

  const fetchHierarchy = async () => {
    try {
      const res = await fetch(`${API_BASE}/hierarchy`);
      const data = await res.json();
	  console.log(data);
	  if (!data.detail) {
		setHierarchy(data);
	  }
    } catch (err) {
      console.error("Error fetching hierarchy:", err);
    }
  };

  const submitSITREP = async () => {
    const payload = { content: sitrep, echelon_level: echelon };
    try {
      const res = await fetch(`${API_BASE}/raw-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.bullet_point_id) {
        alert(`Created ID: ${data.bullet_point_id}\nSummary: ${data.summary_content}`);
        setSitrep("");
        fetchHierarchy();
      }
    } catch (err) {
      console.error("Error creating SITREP:", err);
    }
  };

  const linkPoints = async () => {
    if (!parentId || !childId) {
      alert("Enter valid parent and child IDs.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/bullet-points/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: Number(parentId), child_id: Number(childId) }),
      });
      const data = await res.json();
      if (data.msg) {
        alert(data.msg);
        fetchHierarchy();
      }
    } catch (err) {
      console.error("Error linking bullet points:", err);
    }
  };

  useEffect(() => {
    fetchHierarchy();
  }, []);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Bullet Point Summaries (Enhanced MVP)</h1>

      <div className="mb-6">
        <h2 className="text-xl font-semibold">Create SITREP</h2>
        <textarea
          className="w-full border rounded p-2 mb-2"
          rows={4}
          value={sitrep}
          onChange={(e) => setSitrep(e.target.value)}
        />
        <div className="mb-2">
          <label className="mr-2">Echelon:</label>
          <input
            type="text"
            className="border rounded p-1"
            value={echelon}
            onChange={(e) => setEchelon(e.target.value)}
          />
        </div>
        <button className="bg-blue-500 hover:bg-blue-700 text-white px-4 py-2 rounded" onClick={submitSITREP}>
          Submit SITREP
        </button>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-semibold">Link Bullet Points (Parent → Child)</h2>
        <div className="mb-2">
          <label className="mr-2">Parent BP ID:</label>
          <input
            type="number"
            className="border rounded p-1"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          />
        </div>
        <div className="mb-2">
          <label className="mr-2">Child BP ID:</label>
          <input
            type="number"
            className="border rounded p-1"
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
          />
        </div>
        <button className="bg-blue-500 hover:bg-blue-700 text-white px-4 py-2 rounded" onClick={linkPoints}>
          Link Child
        </button>
      </div>

      <h2 className="text-xl font-semibold mb-2">All Bullet Points (Hierarchy View)</h2>
      <button className="bg-green-500 hover:bg-green-700 text-white px-4 py-2 rounded mb-4" onClick={fetchHierarchy}>
        Refresh Hierarchy
      </button>

      <div>
        {hierarchy.length === 0 ? (
          <p>No bullet points found.</p>
        ) : (
          hierarchy.map((bp) => <div key={bp.bp_id}>{bp.content}</div>)
        )}
      </div>
    </div>
  );
}
