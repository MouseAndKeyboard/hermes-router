"use client";

import { BulletPoint } from "../types";

interface Props {
  bulletPoint: BulletPoint;
}

export default function BulletPointItem({ bulletPoint }: Props) {
  return (
    <div className={`ml-5 border-l-2 pl-2 my-2 ${bulletPoint.validity_status === "invalid" ? "text-red-500 font-bold" : ""}`}>
      <div>
        <strong>ID:</strong> {bulletPoint.bp_id} | <strong>Team:</strong> {bulletPoint.team_id} |
        <strong> Echelon:</strong> {bulletPoint.echelon_level} | <strong>Status:</strong> {bulletPoint.validity_status}
      </div>
      <div><strong>Content:</strong> {bulletPoint.content}</div>

      {bulletPoint.children && bulletPoint.children.length > 0 && (
        <div className="ml-5">
          {bulletPoint.children.map((child) => (
            <BulletPointItem key={child.bp_id} bulletPoint={child} />
          ))}
        </div>
      )}
    </div>
  );
}
