export type MapCampSelectionPhaseV1 =
  | 'selection_received'
  | 'camera_handoff'
  | 'sheet_identity'
  | 'peek_render'
  | 'detail_commit'
  | 'full_render';

const PHASE_ERROR_CODES: Record<MapCampSelectionPhaseV1, string> = {
  selection_received: 'map_camp_selection_received',
  camera_handoff: 'map_camp_camera_handoff',
  sheet_identity: 'map_camp_sheet_identity',
  peek_render: 'map_camp_peek_render',
  detail_commit: 'map_camp_detail_commit',
  full_render: 'map_camp_full_render',
};

let currentPhase: MapCampSelectionPhaseV1 | null = null;

export function markMapCampSelectionPhaseV1(phase: MapCampSelectionPhaseV1): void {
  currentPhase = phase;
}

export function clearMapCampSelectionPhaseV1(): void {
  currentPhase = null;
}

export function currentMapCampSelectionPhaseV1(): MapCampSelectionPhaseV1 | null {
  return currentPhase;
}

export function mapCampSelectionErrorCodeV1(
  phase: MapCampSelectionPhaseV1 | null = currentPhase,
): string {
  return phase ? PHASE_ERROR_CODES[phase] : 'map_camp_unknown_phase';
}

export function mapCampSelectionDiagnosticAllowedV1(input: {
  channel?: string | null;
  authenticated: boolean;
  isAdmin: boolean;
}): boolean {
  return input.channel === 'preview' && input.authenticated && input.isAdmin;
}
