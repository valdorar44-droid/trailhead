export type OriginalVehicleKindV1 =
  | 'passenger'
  | 'motorcycle'
  | 'motorhome'
  | 'bus'
  | 'commercial_service'
  | 'van_camper'
  | 'other';

export type OriginalOperationalVehicleClassV1 =
  | 'passenger'
  | 'motorcycle'
  | 'motorhome'
  | 'bus'
  | 'commercial_service'
  | 'towing_trailer'
  | 'van_over_25_ft';

export type OriginalVehicleBindingInputV1 = {
  vehicle_kind: OriginalVehicleKindV1;
  vehicle_length_ft: number | null;
  is_towing: boolean;
};

export type OriginalVehicleBindingV1 = OriginalVehicleBindingInputV1 & {
  schema_version: 1;
  binding_id: string;
  revision: number;
  vehicle_class: OriginalOperationalVehicleClassV1 | null;
  complete: boolean;
  updated_at: number;
};

export type OriginalVehicleBindingEnvelopeV1 = {
  binding: OriginalVehicleBindingV1 | null;
};

export type OriginalVehicleRigInput = {
  vehicle_type?: string | null;
  length_ft?: string | number | null;
  is_towing?: boolean | null;
};

function restrictionLength(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}

function operationalKind(vehicleType: string | null | undefined): OriginalVehicleKindV1 {
  const normalized = String(vehicleType ?? '').trim().toLowerCase();
  if (normalized === 'truck' || normalized === 'jeep' || normalized === 'suv') return 'passenger';
  if (normalized === 'moto' || normalized === 'motorcycle') return 'motorcycle';
  if (normalized === 'van/camper' || normalized === 'van camper' || normalized === 'van_camper') {
    return 'van_camper';
  }
  if (normalized === 'motorhome') return 'motorhome';
  if (normalized === 'bus') return 'bus';
  if (normalized === 'commercial service' || normalized === 'commercial_service') {
    return 'commercial_service';
  }
  return 'other';
}

/** Projects only the fields needed for source-owned road restrictions. */
export function projectOriginalVehicleBinding(
  rig: OriginalVehicleRigInput,
): OriginalVehicleBindingInputV1 {
  return {
    vehicle_kind: operationalKind(rig.vehicle_type),
    vehicle_length_ft: restrictionLength(rig.length_ft),
    is_towing: rig.is_towing === true,
  };
}

export function originalVehicleBindingMatchesProjection(
  binding: OriginalVehicleBindingV1,
  projection: OriginalVehicleBindingInputV1,
): boolean {
  return binding.vehicle_kind === projection.vehicle_kind
    && binding.vehicle_length_ft === projection.vehicle_length_ft
    && binding.is_towing === projection.is_towing;
}
