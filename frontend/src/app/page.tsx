"use client";

import { useState, useEffect } from "react";
import BulletPointItem from "../components/BulletPoint";
import { BulletPoint } from "../types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export default function Home() {
  // State for forms
  const [teamName, setTeamName] = useState("");
  const [teamEchelon, setTeamEchelon] = useState("Platoon");
  const [teamParent, setTeamParent] = useState("");

  const [ccirTeamId, setCcirTeamId] = useState("");
  const [ccirDesc, setCcirDesc] = useState("");
  const [ccirKeywords, setCcirKeywords] = useState("");

  const [rawTeamId, setRawTeamId] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [rawSourceType, setRawSourceType] = useState("sitrep");

  const [bpTeamId, setBpTeamId] = useState("");
  const [bpEchelon, setBpEchelon] = useState("Platoon");
  const [bpContent, setBpContent] = useState("");
  const [bpChildren, setBpChildren] = useState("");
  const [bpRawChildren, setBpRawChildren] = useState("");

  const [parentId, setParentId] = useState("");
  const [childId, setChildId] = useState("");

  const [invBpId, setInvBpId] = useState("");

  const [focusTeamId, setFocusTeamId] = useState("");
  const [includeSubs, setIncludeSubs] = useState(true);

  const [hierarchy, setHierarchy] = useState<BulletPoint[]>([]);
  const [teamHierarchy, setTeamHierarchy] = useState<BulletPoint[]>([]);

  // === API Calls ===
  const fetchHierarchy = async () => {
    try {
      const res = await fetch(`${API_BASE}/hierarchy`);
      const data = await res.json();
      setHierarchy(data);
    } catch (err) {
      console.error("Error fetching hierarchy:", err);
    }
  };

  const fetchTeamHierarchy = async () => {
    if (!focusTeamId) {
      alert("Please enter a valid Team ID.");
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/bullet-points/team/${focusTeamId}/hierarchy?include_subteams=${includeSubs}`
      );
      const data = await res.json();
      setTeamHierarchy(data);
    } catch (err) {
      console.error("Error fetching team hierarchy:", err);
    }
  };

  const createRawData = async () => {
    const payload = { team_id: Number(rawTeamId), content: rawContent, source_type: rawSourceType };
    try {
      const res = await fetch(`${API_BASE}/raw-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert(JSON.stringify(await res.json()));
    } catch (err) {
      alert("Error creating raw data: " + err);
    }
  };

  const createBulletPoint = async () => {
    const payload = {
      team_id: Number(bpTeamId),
      echelon_level: bpEchelon,
      content: bpContent,
      child_bps: bpChildren.split(",").map(Number),
      child_raws: bpRawChildren.split(",").map(Number),
    };
    try {
      const res = await fetch(`${API_BASE}/bullet-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert(JSON.stringify(await res.json()));
    } catch (err) {
      alert("Error creating bullet point: " + err);
    }
  };

  const linkPoints = async () => {
    const payload = { parent_id: Number(parentId), child_id: Number(childId) };
    try {
      const res = await fetch(`${API_BASE}/bullet-points/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      alert(JSON.stringify(await res.json()));
    } catch (err) {
      alert("Error linking bullet points: " + err);
    }
  };

  const invalidateBP = async () => {
    try {
      const res = await fetch(`${API_BASE}/bullet-points/invalidate/${Number(invBpId)}`, {
        method: "POST",
      });
      alert(JSON.stringify(await res.json()));
    } catch (err) {
      alert("Error invalidating bullet point: " + err);
    }
  };

  useEffect(() => {
    fetchHierarchy();
  }, []);

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Bullet Point Hierarchy MVP</h1>

	  {/* Team Creation */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Create Team</h2>
        <input className="border p-2 w-full" placeholder="Team Name" onChange={(e) => setTeamName(e.target.value)} />
        <input className="border p-2 w-full" placeholder="Echelon Level" onChange={(e) => setTeamEchelon(e.target.value)} />
        <input className="border p-2 w-full" placeholder="Parent Team ID" onChange={(e) => setTeamParent(e.target.value)} />
        <button className="bg-blue-500 text-white px-4 py-2 mt-2" onClick={() => console.log("Create Team API Call")}>
          Create Team
        </button>
      </section>

      {/* CCIR Creation */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Create CCIR</h2>
        <input className="border p-2 w-full" placeholder="Team ID" onChange={(e) => setCcirTeamId(e.target.value)} />
        <input className="border p-2 w-full" placeholder="Description" onChange={(e) => setCcirDesc(e.target.value)} />
        <input className="border p-2 w-full" placeholder="Keywords (comma-separated)" onChange={(e) => setCcirKeywords(e.target.value)} />
        <button className="bg-blue-500 text-white px-4 py-2 mt-2" onClick={() => console.log("Create CCIR API Call")}>
          Create CCIR
        </button>
      </section>

      {/* Create Raw Data */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Create Raw Data</h2>
        <input className="border p-2 w-full" placeholder="Team ID" onChange={(e) => setRawTeamId(e.target.value)} />
        <textarea className="border p-2 w-full" placeholder="Content" onChange={(e) => setRawContent(e.target.value)} />
        <button className="bg-blue-500 text-white px-4 py-2 mt-2" onClick={createRawData}>
          Create Raw Data
        </button>
      </section>

      {/* Link Bullet Points */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Link Bullet Points</h2>
        <input className="border p-2 w-full" placeholder="Parent ID" onChange={(e) => setParentId(e.target.value)} />
        <input className="border p-2 w-full" placeholder="Child ID" onChange={(e) => setChildId(e.target.value)} />
        <button className="bg-blue-500 text-white px-4 py-2 mt-2" onClick={linkPoints}>
          Link Child
        </button>
      </section>

      {/* Invalidate Bullet Point */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Invalidate Bullet Point</h2>
        <input className="border p-2 w-full" placeholder="Bullet Point ID" onChange={(e) => setInvBpId(e.target.value)} />
        <button className="bg-red-500 text-white px-4 py-2 mt-2" onClick={invalidateBP}>
          Invalidate
        </button>
      </section>

	  {/* Global Hierarchy */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Global Bullet Point Hierarchy</h2>
        <button className="bg-green-500 text-white px-4 py-2 mt-2" onClick={fetchHierarchy}>
          Refresh Global Hierarchy
        </button>
        <div className="mt-4">
          {hierarchy.length === 0 ? (
            <p>No bullet points found.</p>
          ) : (
            hierarchy.map((bp) => <BulletPointItem key={bp.bp_id} bulletPoint={bp} />)
          )}
        </div>
      </section>

      {/* Team-Focused Hierarchy */}
      <section className="border p-4 my-4">
        <h2 className="text-xl font-semibold">Team-Focused Hierarchy</h2>
        <input className="border p-2 w-full" placeholder="Team ID" onChange={(e) => setFocusTeamId(e.target.value)} />
        <button className="bg-green-500 text-white px-4 py-2 mt-2" onClick={fetchTeamHierarchy}>
          Load Team Hierarchy
        </button>
        <div className="mt-4">
          {teamHierarchy.length === 0 ? (
            <p>No bullet points found.</p>
          ) : (
            teamHierarchy.map((bp) => <BulletPointItem key={bp.bp_id} bulletPoint={bp} />)
          )}
        </div>
      </section>
    </div>
  );
}
