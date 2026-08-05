import assert from 'node:assert/strict';
import test from 'node:test';
import {
  originalVehicleBindingMatchesProjection,
  projectOriginalVehicleBinding,
  type OriginalVehicleBindingV1,
} from '../vehicleBinding';

test('projects only restriction-relevant fields', () => {
  const projection = projectOriginalVehicleBinding({
    vehicle_type: 'Truck',
    length_ft: '19.25',
    is_towing: false,
    make: 'Private make',
    model: 'Private model',
    nickname: 'Private nickname',
  } as any);
  assert.deepEqual(projection, {
    vehicle_kind: 'passenger',
    vehicle_length_ft: 19.25,
    is_towing: false,
  });
  assert.deepEqual(Object.keys(projection).sort(), [
    'is_towing',
    'vehicle_kind',
    'vehicle_length_ft',
  ]);
});

test('maps current rig categories without guessing ambiguous setups', () => {
  assert.equal(projectOriginalVehicleBinding({ vehicle_type: 'Jeep' }).vehicle_kind, 'passenger');
  assert.equal(projectOriginalVehicleBinding({ vehicle_type: 'SUV' }).vehicle_kind, 'passenger');
  assert.equal(projectOriginalVehicleBinding({ vehicle_type: 'Moto' }).vehicle_kind, 'motorcycle');
  assert.deepEqual(projectOriginalVehicleBinding({ vehicle_type: 'Van/Camper', length_ft: '' }), {
    vehicle_kind: 'van_camper',
    vehicle_length_ft: null,
    is_towing: false,
  });
  assert.equal(projectOriginalVehicleBinding({ vehicle_type: 'Other' }).vehicle_kind, 'other');
  assert.equal(projectOriginalVehicleBinding({ vehicle_type: 'Van/Camper', length_ft: 'not a number' }).vehicle_length_ft, null);
});

test('preserves towing and the exact 25 foot boundary for server derivation', () => {
  assert.deepEqual(projectOriginalVehicleBinding({
    vehicle_type: 'Van/Camper',
    length_ft: '25.005',
    is_towing: true,
  }), {
    vehicle_kind: 'van_camper',
    vehicle_length_ft: 25.01,
    is_towing: true,
  });
});

test('detects a stale server binding without trusting its derived class', () => {
  const binding: OriginalVehicleBindingV1 = {
    schema_version: 1,
    binding_id: 'ovb_test_binding_12345678901234567890',
    revision: 1,
    vehicle_kind: 'passenger',
    vehicle_length_ft: 19,
    is_towing: false,
    vehicle_class: 'passenger',
    complete: true,
    updated_at: 1,
  };
  assert.equal(originalVehicleBindingMatchesProjection(
    binding,
    projectOriginalVehicleBinding({ vehicle_type: 'Truck', length_ft: '19' }),
  ), true);
  assert.equal(originalVehicleBindingMatchesProjection(
    binding,
    projectOriginalVehicleBinding({ vehicle_type: 'Truck', length_ft: '19', is_towing: true }),
  ), false);
});
