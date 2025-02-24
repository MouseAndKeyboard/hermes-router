// types.ts
export type BulletPoint = {
  bp_id: number;
  content: string;
  team_id: number;
  echelon_level: string;
  validity_status: string;
  children?: BulletPoint[];
};

export type Team = {
  team_id: number;
  team_name: string;
  echelon_level: string;
  parent_team_id?: number | null;
};

export type CCIR = {
  ccir_id: number;
  team_id: number;
  description: string;
  keywords: string[];
};
