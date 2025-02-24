"use client";

import React, {
  useState,
  useEffect,
  MouseEvent,
  ChangeEvent,
  JSX,
  FC,
} from "react";

/** ====== Data Models ====== **/
interface Team {
  team_id: number;
  parent_team_id?: number | null;
  team_name: string;
  echelon_level: string;
}

interface RawData {
  raw_data_id: number;
  team_id: number;
  content: string;
  source_type: string;
}

interface BulletPoint {
  bp_id: number;
  team_id: number;
  content: string;
  validity_status: string; // e.g., "valid", "invalid"
  children?: BulletPoint[];
}

interface BulletPointDetails {
  bp_id: number;
  team_id: number;
  content: string;
  validity_status: string;
  created_at?: string;
  child_bullet_points: number[];
  child_raw_data: number[];
}

/** 
 * For the POST /summaries/regenerate endpoint, 
 * we don't know the exact shape. Adjust as needed.
 */
interface SummariesRegenerateResponse {
  [key: string]: unknown;
}

/** 
 * For the POST /raw-data endpoint, 
 * we also don't know the exact returned shape. Adjust as needed.
 */
interface CreateRawDataResponse {
  [key: string]: unknown;
}

/** 
 * For building out the provenance tree in the front-end:
 */
interface ProvenanceNode {
  detail: BulletPointDetails;          // This bullet point's details
  children: ProvenanceNode[];          // Child bullet points
  rawData: number[];                   // Raw data IDs
}

const API_BASE = "http://localhost:8000";

/** 
 * This modal shows a nested/indented chain of bullet-point sources. 
 * The `root` is the bullet point the user clicked on. 
 * We recursively display child bullet points and raw-data references.
 */
const ProvenanceModal: FC<{
  root: ProvenanceNode | null;
  onClose: () => void;
}> = ({ root, onClose }) => {
  if (!root) return null;

  // A small helper to render nested bullet points
  const renderProvenanceTree = (node: ProvenanceNode, level = 0): JSX.Element => {
    const indentPx = 20 * level; // indent each level
    return (
      <div style={{ marginLeft: indentPx, marginTop: "0.5em" }}>
        <div style={{ fontWeight: "bold" }}>
          Bullet #{node.detail.bp_id} (Team {node.detail.team_id})  
          {" – "}
          <span style={{ fontStyle: "italic" }}>{node.detail.validity_status}</span>
        </div>
        <div style={{ marginLeft: 10 }}>
          {node.detail.content}
          {node.rawData.length > 0 && (
            <div style={{ fontSize: "0.9em", color: "#333", marginTop: "0.25em" }}>
              <strong>Raw Data IDs:</strong> {node.rawData.join(", ")}
            </div>
          )}
        </div>
        {node.children.map((childNode) => renderProvenanceTree(childNode, level + 1))}
      </div>
    );
  };

  return (
    <div className="prov-overlay">
      <div className="prov-modal">
        <h2>Provenance Graph</h2>
        <p style={{ fontSize: "0.85em", marginTop: "-0.5em", lineHeight: "1.4em" }}>
          Below is the chain of bullet points (and any raw data) that feed into 
          the selected fact. Each level is indented.
        </p>
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {renderProvenanceTree(root)}
        </div>

        <div style={{ marginTop: "1em", textAlign: "right" }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

const TeamFocusedSummaries: React.FC = (): React.ReactElement => {
  // ======= State Hooks =======
  const [isOnboardingVisible, setIsOnboardingVisible] = useState<boolean>(true);
  const [isHelpVisible, setIsHelpVisible] = useState<boolean>(false);

  const [ccirKeyword, setCcirKeyword] = useState<string>("");
  const [myTeamId, setMyTeamId] = useState<number | undefined>(undefined);

  const [teamsList, setTeamsList] = useState<Team[]>([]);
  const [hierarchy, setHierarchy] = useState<BulletPoint[]>([]);

  const [teamInfo, setTeamInfo] = useState<Team | null>(null);
  const [subordinates, setSubordinates] = useState<Team[]>([]);
  const [myRawData, setMyRawData] = useState<RawData[]>([]);
  const [mySummary, setMySummary] = useState<BulletPoint[]>([]);

  const [newRawContent, setNewRawContent] = useState<string>("");
  const [newRawType, setNewRawType] = useState<string>("sitrep");

  // For provenance modal
  const [provenanceRoot, setProvenanceRoot] = useState<ProvenanceNode | null>(null);

  // ======= Effects =======
  useEffect((): void => {
    fetchTeams();
    fetchHierarchy();
    // Show onboarding overlay automatically once
    setIsOnboardingVisible(true);
  }, []);

  // ======= Fetch Teams =======
  const fetchTeams = async (): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/teams`);
      const data = (await resp.json()) as Team[];
      setTeamsList(data);
    } catch (err) {
      alert("Error fetching teams: " + String(err));
    }
  };

  // ======= Fetch Full Hierarchy (All Bullet Points) =======
  const fetchHierarchy = async (): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/hierarchy`);
      const data = (await resp.json()) as BulletPoint[];
      setHierarchy(data);
    } catch (err) {
      alert("Error fetching hierarchy: " + String(err));
    }
  };

  // ======= Regenerate Summaries with optional CCIR =======
  const regenerateWithCCIR = async (): Promise<void> => {
    try {
      const trimmedCcir = ccirKeyword.trim();
      let url = `${API_BASE}/summaries/regenerate`;
      if (trimmedCcir) {
        url += `?ccir=${encodeURIComponent(trimmedCcir)}`;
      }
      const resp = await fetch(url, { method: "POST" });
      const data = (await resp.json()) as SummariesRegenerateResponse;
      alert(JSON.stringify(data));
      // After regenerating, re-fetch the new bullet points
      fetchHierarchy();
      if (myTeamId) {
        loadMySummaryBPs(myTeamId);
      }
    } catch (err) {
      alert("Error regenerating summaries: " + String(err));
    }
  };

  // ======= Load Team Page (Team Info, Subordinates, Raw Data, Summary) =======
  const loadTeamPage = async (): Promise<void> => {
    if (!myTeamId) {
      alert("Please enter a valid team ID.");
      return;
    }
    const found = teamsList.find((tm) => tm.team_id === myTeamId);
    if (!found) {
      alert("Team not found in /teams list.");
      return;
    }
    setTeamInfo(found);

    // Determine subordinates
    const byParent: Record<number, Team[]> = {};
    teamsList.forEach((tm) => {
      const pid = tm.parent_team_id || 0;
      if (!byParent[pid]) {
        byParent[pid] = [];
      }
      byParent[pid].push(tm);
    });
    const subs: Team[] = byParent[myTeamId] || [];
    setSubordinates(subs);

    // Load my raw data
    loadMyRawDataRequest(myTeamId);
    // Load my summary bullet points
    loadMySummaryBPs(myTeamId);
  };

  // ======= Load My Raw Data =======
  const loadMyRawDataRequest = async (teamId: number): Promise<void> => {
    try {
      const resp = await fetch(`${API_BASE}/raw-data/${teamId}`);
      const data = (await resp.json()) as RawData[];
      setMyRawData(data);
    } catch (err) {
      alert("Error loading raw data: " + String(err));
    }
  };

  // ======= Create Raw Data (POST) =======
  const createMyRawData = async (): Promise<void> => {
    if (!myTeamId) {
      alert("Team not loaded yet.");
      return;
    }
    const payload = {
      team_id: myTeamId,
      content: newRawContent,
      source_type: newRawType,
    };
    try {
      const resp = await fetch(`${API_BASE}/raw-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json()) as CreateRawDataResponse;
      alert(JSON.stringify(data));
      // Reload raw data display
      loadMyRawDataRequest(myTeamId);
    } catch (err) {
      alert("Error creating raw data: " + String(err));
    }
  };

  // ======= Load My Summary Bullet Points (Local Filter of Hierarchy) =======
  const loadMySummaryBPs = (teamId: number): void => {
    const relevantBPs: BulletPoint[] = [];

    const findTeamBPs = (bp: BulletPoint): void => {
      if (bp.team_id === teamId) {
        relevantBPs.push(bp);
      }
      if (bp.children && bp.children.length > 0) {
        bp.children.forEach((child) => findTeamBPs(child));
      }
    };

    hierarchy.forEach((rootBP) => findTeamBPs(rootBP));
    setMySummary(relevantBPs);
  };

  // ======= Toggle Collapsible (subordinate listing) =======
  const toggleCollapsible = (e: MouseEvent<HTMLButtonElement>): void => {
    const btn = e.currentTarget;
    btn.classList.toggle("active");
    const content = btn.nextElementSibling as HTMLElement | null;
    if (!content) return;
    content.style.display =
      content.style.display === "block" ? "none" : "block";
  };

  // ======= Render Subordinate Bullet Points =======
  const renderSubordinateBPList = (sub: Team): JSX.Element => {
    const relevantBPs: BulletPoint[] = [];

    const collectBPs = (bp: BulletPoint): void => {
      if (bp.team_id === sub.team_id) {
        relevantBPs.push(bp);
      }
      if (bp.children && bp.children.length > 0) {
        bp.children.forEach((c) => collectBPs(c));
      }
    };

    hierarchy.forEach((root) => collectBPs(root));

    if (relevantBPs.length === 0) {
      return <p style={{ margin: "0.5em 0" }}>No bullet points found.</p>;
    }

    return (
      <>
        {relevantBPs.map((bp) => (
          <div
            key={bp.bp_id}
            className={`bullet-point ${bp.validity_status === "invalid" ? "invalid" : ""}`}
            onClick={(e): void => {
              e.stopPropagation();
              openProvenanceModal(bp.bp_id);
            }}
          >
            <div className="bullet-id-status">
              <span className="bp-id">#{bp.bp_id}</span>
              <span className="bp-status">{bp.validity_status}</span>
            </div>
            <div className="bp-content">{bp.content}</div>
          </div>
        ))}
      </>
    );
  };

  // ======= PROVENANCE (Recursive) =======
  const openProvenanceModal = async (bpId: number): Promise<void> => {
    const node = await buildProvenanceNode(bpId);
    setProvenanceRoot(node);
  };

  const buildProvenanceNode = async (bpId: number): Promise<ProvenanceNode> => {
    const detail = await fetchBPDetails(bpId);

    // Build children
    const childNodes: ProvenanceNode[] = [];
    for (const cId of detail.child_bullet_points) {
      const childNode = await buildProvenanceNode(cId);
      childNodes.push(childNode);
    }

    return {
      detail,
      children: childNodes,
      rawData: detail.child_raw_data
    };
  };

  const fetchBPDetails = async (bpId: number): Promise<BulletPointDetails> => {
    const resp = await fetch(`${API_BASE}/bullet-points/${bpId}`);
    if (!resp.ok) {
      throw new Error(`Failed to fetch bullet point details for #${bpId}`);
    }
    return (await resp.json()) as BulletPointDetails;
  };

  // ======= Invalidate a Bullet Point =======
  const invalidateBP = async (bpId: number): Promise<void> => {
    try {
      const url = `${API_BASE}/bullet-points/invalidate/${bpId}`;
      const resp = await fetch(url, { method: "POST" });
      if (!resp.ok) {
        throw new Error(`HTTP error! Status: ${resp.status}`);
      }
      alert(`Bullet Point #${bpId} invalidated.`);
      // Refresh data
      fetchHierarchy();
      if (myTeamId) loadMySummaryBPs(myTeamId);
    } catch (err) {
      alert("Error invalidating bullet point: " + String(err));
    }
  };

  // ======= Common Bullet Point Renderer for My Summary =======
  const renderMyBulletPointHTML = (bp: BulletPoint): JSX.Element => {
    const invalidClass = bp.validity_status === "invalid" ? "invalid" : "";
    return (
      <div
        key={bp.bp_id}
        className={`bullet-point ${invalidClass}`}
        style={{ position: "relative" }}
        onClick={(e): void => {
          e.stopPropagation();
          openProvenanceModal(bp.bp_id);
        }}
      >
        <div className="bullet-id-status">
          <span className="bp-id">#{bp.bp_id}</span>
          <span className="bp-status">{bp.validity_status}</span>
        </div>
        <div className="bp-content">{bp.content}</div>
        {/* Invalidate button */}
        <button
          style={{
            position: "absolute",
            top: "2.5em",
            right: "0.0em",
            backgroundColor: "#B22222", // a red-ish color
            fontSize: "0.75em",
            padding: "0.2em 0.4em",
          }}
          onClick={(e) => {
            e.stopPropagation();
            invalidateBP(bp.bp_id);
          }}
        >
          Invalidate
        </button>
      </div>
    );
  };

  // ======= Render =======
  return (
    <>
      {/* Inline Styles */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          body {
            font-family: "Arial", sans-serif;
            margin: 0;
            padding: 0;
            background: #dcdcdc; /* A neutral gray */
          }
          .app-container {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
          }

          /* Header with more "Army" color scheme */
          .header {
            background: #3a4f3d; /* Army-ish green tone */
            color: #fff;
            padding: 0.5em 1em;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .header h1 {
            margin: 0;
            font-size: 1.2rem;
            font-weight: bold;
          }
          .header-right {
            display: flex;
            align-items: center;
          }
          .header-right input {
            margin-right: 0.5em;
            border: 1px solid #ccc;
            padding: 0.3em;
            font-size: 0.9rem;
          }
          .help-icon {
            margin-left: 8px;
            cursor: pointer;
            color: #fff;
            font-weight: bold;
            border: 1px solid #ccc;
            border-radius: 2px;
            padding: 0 5px;
          }
          .help-icon:hover {
            background: #2a3b2d;
          }

          /* Content layout: two columns, no shadow, minimal rounding. */
          .content-wrapper {
            display: flex;
            flex: 1;
            padding: 1em;
            gap: 1em;
          }
          .left-column, .right-column {
            background: #f8f8f8;
            flex: 1;
            padding: 0.8em;
            border: 1px solid #aaa;
            border-radius: 2px;
            overflow-y: auto;
          }
          .left-column {
            max-width: 48%;
          }
          .right-column {
            max-width: 48%;
          }

          /* Onboarding Overlay */
          .overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 9999;
          }
          .overlay.active {
            display: flex;
          }
          .overlay-content {
            background: #fff;
            padding: 2em;
            max-width: 600px;
            border: 2px solid #3a4f3d;
            border-radius: 2px;
          }
          .overlay h2 {
            margin-top: 0;
          }

          /* Help Section */
          .help-section {
            background: #fff;
            padding: 1em;
            border-radius: 2px;
            border: 1px solid #aaa;
            margin-top: 0.5em;
            display: none;
          }
          .help-section.active {
            display: block;
          }

          /* Sections */
          .section {
            margin-bottom: 1em;
            border-bottom: 1px solid #ccc;
            padding-bottom: 0.5em;
          }
          .section h2 {
            margin-top: 0;
            font-size: 1rem;
            font-weight: bold;
            color: #333;
          }
          label {
            font-weight: bold;
            margin-right: 0.5em;
          }
          input[type="text"], input[type="number"], textarea {
            width: 100%;
            box-sizing: border-box;
            margin-top: 0.3em;
            margin-bottom: 0.8em;
            padding: 0.3em;
            font-size: 0.9rem;
            border: 1px solid #ccc;
          }
          button {
            cursor: pointer;
            background: #2e4e2c;
            color: #fff;
            border: 1px solid #263b24;
            border-radius: 2px;
            padding: 0.4em 0.8em;
            font-size: 0.9rem;
            margin-right: 0.5em;
          }
          button:hover {
            background: #253f21;
          }
          textarea {
            resize: vertical;
          }

          /* Collapsible */
          .collapsible {
            cursor: pointer;
            font-weight: bold;
            margin-top: 0.5em;
            border: 1px solid #aaa;
            background: #ddd;
            padding: 0.5em;
            width: 100%;
            text-align: left;
            border-radius: 2px;
            outline: none;
            font-size: 0.9rem;
          }
          .collapsible:after {
            content: ' \\25BC'; /* down arrow */
            float: right;
          }
          .collapsible.active:after {
            content: ' \\25B2'; /* up arrow */
          }
          .collapsible-content {
            display: none;
            margin: 0.5em 0;
            padding: 0.5em;
            background: #ececec;
            border-radius: 2px;
            border: 1px solid #bbb;
          }

          /* Bullet Points */
          .bullet-point {
            padding: 0.5em;
            border: 1px dashed #999;
            border-radius: 2px;
            margin-bottom: 0.5em;
            background: #fafafa;
            transition: background 0.2s;
            position: relative;
          }
          .bullet-point:hover {
            background: #f0f0f0;
          }
          .invalid {
            border-color: #c33;
            color: #c33;
          }
          .bullet-id-status {
            display: flex;
            justify-content: space-between;
            font-size: 0.85rem;
            margin-bottom: 0.2em;
          }
          .bp-id {
            font-weight: bold;
          }
          .bp-status {
            font-style: italic;
          }
          .bp-content {
            font-size: 0.9rem;
          }

          /* Team Info */
          .team-info {
            background: #f1f1f1;
            padding: 0.8em;
            border-radius: 2px;
            margin-bottom: 1em;
            border: 1px solid #aaa;
          }

          /* Smaller list items for raw data */
          #myRawList ul {
            padding-left: 1.2em;
            margin: 0;
            list-style: circle;
          }
          #myRawList li {
            margin-bottom: 0.3em;
          }

          /* Footer or extra spacing if needed */
          .footer {
            text-align: center;
            padding: 1em;
            background: #3a4f3d;
            color: #fff;
            font-size: 0.8rem;
          }

          /* PROVENANCE MODAL STYLES */
          .prov-overlay {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
          }
          .prov-modal {
            background: #fff;
            border: 1px solid #333;
            border-radius: 2px;
            padding: 1em;
            max-width: 600px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
          }
          .prov-modal h2 {
            margin-top: 0;
            color: #2e4e2c;
            font-size: 1.1rem;
          }
        `,
        }}
      />

      {/* Provenance Modal */}
      {provenanceRoot && (
        <ProvenanceModal
          root={provenanceRoot}
          onClose={() => setProvenanceRoot(null)}
        />
      )}

      {/* App Container */}
      <div className="app-container">
        {/* Header */}
        <div className="header">
          <h1>AUSTRALIAN ARMY - Team-Focused Summaries</h1>
          <div className="header-right">
            <input
              id="ccirKeyword"
              type="text"
              placeholder="Filter (CCIR)"
              value={ccirKeyword}
              onChange={(e: ChangeEvent<HTMLInputElement>): void =>
                setCcirKeyword(e.target.value)
              }
            />
            <button onClick={regenerateWithCCIR}>Regenerate</button>
            <span
              className="help-icon"
              title="Click for help"
              onClick={() => setIsHelpVisible(!isHelpVisible)}
            >
              ?
            </span>
          </div>
        </div>

        {/* Help Section */}
        <div className={`help-section ${isHelpVisible ? "active" : ""}`}>
          <h2>How This System Works</h2>
          <p>
            This platform uses a <strong>recursive</strong> approach to
            intelligence summarization:
          </p>
          <ul>
            <li>
              <strong>Raw Data</strong>: SITREPs, logs, sensor feeds <em>owned by each team</em>.
            </li>
            <li>
              <strong>Subordinate Summaries</strong>: Each subordinate team also
              produces bullet points. These get passed up automatically once you regenerate.
            </li>
            <li>
              <strong>Combined Summary</strong>: Your team’s summary = your raw data
              + subordinates’ bullet points (filtered by CCIR if provided).
            </li>
            <li>
              <strong>Provenance</strong>: Click any bullet point to see its chain of sources
              (including raw data).
            </li>
          </ul>
          <button onClick={() => setIsHelpVisible(false)}>Close Help</button>
        </div>

        {/* Onboarding Overlay */}
        <div className={`overlay ${isOnboardingVisible ? "active" : ""}`}>
          <div className="overlay-content">
            <h2>Welcome to Team-Focused Summaries!</h2>
            <p>
              This short tutorial explains the recursive bullet-point approach,
              raw data vs. subordinate summaries, and how CCIR filtering works.
            </p>
            <ol>
              <li>
                <strong>Your Team's Perspective</strong>: Each team sees its own raw data plus bullet points from subordinates.
              </li>
              <li>
                <strong>Raw Data</strong>: SITREPs, logs, or sensor feeds. You can add new raw data from the “Add Raw Data” form.
              </li>
              <li>
                <strong>Summaries</strong>: Automatic bullet points are generated from your raw data + subordinate bullet points. CCIR (keyword) filters them.
              </li>
              <li>
                <strong>Provenance</strong>: Click a bullet point to see exactly which child bullet points or raw data formed it.
              </li>
            </ol>
            <p style={{ textAlign: "right" }}>
              <button onClick={() => setIsOnboardingVisible(false)}>Got It!</button>
            </p>
          </div>
        </div>

        {/* Main Content Two-Column Layout */}
        <div className="content-wrapper">
          {/* LEFT COLUMN */}
          <div className="left-column">
            <div className="section">
              <h2>Select Your Team</h2>
              <div>
                <label>Team ID:</label>
                <input
                  id="myTeamId"
                  type="number"
                  placeholder="e.g. 5"
                  value={myTeamId ?? ""}
                  onChange={(e: ChangeEvent<HTMLInputElement>): void =>
                    setMyTeamId(Number(e.target.value))
                  }
                />
                <button onClick={loadTeamPage}>Load Team</button>
              </div>
            </div>

            {teamInfo && (
              <div className="team-info" id="teamInfoSection">
                <h3 id="teamNameLabel" style={{ marginTop: "0" }}>
                  {teamInfo.team_name}
                </h3>
                <p style={{ margin: "0.5em 0" }}>
                  <strong>Echelon:</strong> {teamInfo.echelon_level}
                  <br />
                  <strong>Parent Team ID:</strong>{" "}
                  {teamInfo.parent_team_id ?? "None"}
                </p>
              </div>
            )}

            {teamInfo && (
              <div className="section" id="subordinatesSection">
                <h2>Subordinate Teams</h2>
                <div id="subordinatesContainer">
                  {subordinates.length === 0 ? (
                    <p>No direct subordinates.</p>
                  ) : (
                    subordinates.map((st) => (
                      <React.Fragment key={st.team_id}>
                        <button
                          className="collapsible"
                          onClick={(e): void => toggleCollapsible(e)}
                        >
                          {st.team_name} (ID: {st.team_id})
                        </button>
                        <div
                          className="collapsible-content"
                          id={`subSummary_${st.team_id}`}
                        >
                          {renderSubordinateBPList(st)}
                        </div>
                      </React.Fragment>
                    ))
                  )}
                </div>
              </div>
            )}

            {teamInfo && (
              <div className="section" id="myRawDataSection">
                <h2>My Raw Data</h2>
                <div id="myRawList">
                  {myRawData.length === 0 ? (
                    <p>No raw data for this team yet.</p>
                  ) : (
                    <ul>
                      {myRawData.map((rd) => (
                        <li key={rd.raw_data_id}>
                          <strong>Raw#{rd.raw_data_id}:</strong> {rd.content}{" "}
                          <em>({rd.source_type})</em>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <h3 style={{ marginTop: "1em" }}>Add Raw Data</h3>
                <label htmlFor="newRawContent">Content:</label>
                <textarea
                  id="newRawContent"
                  rows={2}
                  value={newRawContent}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>): void =>
                    setNewRawContent(e.target.value)
                  }
                />
                <label htmlFor="newRawType">Source Type:</label>
                <input
                  id="newRawType"
                  type="text"
                  value={newRawType}
                  onChange={(e: ChangeEvent<HTMLInputElement>): void =>
                    setNewRawType(e.target.value)
                  }
                />
                <button onClick={createMyRawData}>Add Raw Data</button>
                <p style={{ fontSize: "0.8em", color: "#666", marginTop: "0.5em" }}>
                  (Summaries update after you click <strong>Regenerate</strong> up top.)
                </p>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN */}
          <div className="right-column">
            {teamInfo && (
              <div className="section" id="mySummarySection">
                <h2>My Summary (Bullet Points)</h2>
                <p style={{ fontSize: "0.8em", marginTop: "-0.5em", color: "#666" }}>
                  Combines your raw data + subordinates' bullet points (filtered by CCIR if provided).
                </p>
                <div id="mySummaryContainer">
                  {mySummary.length === 0 ? (
                    <p>No bullet points found for this team.</p>
                  ) : (
                    mySummary.map((bp) => renderMyBulletPointHTML(bp))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          &copy; {new Date().getFullYear()} Australian Army - All Rights Reserved
        </div>
      </div>
    </>
  );
};

export default TeamFocusedSummaries;
