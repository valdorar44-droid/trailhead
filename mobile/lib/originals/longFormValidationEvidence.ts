export type OriginalLongFormEvidenceKind = 'roaring_fork' | 'remaining';

export type OriginalLongFormEvidenceRow = Readonly<{
  key: string;
  kind: OriginalLongFormEvidenceKind;
  preflight_path: string | null;
  preflight_sha256: string | null;
  readiness_path: string;
  readiness_sha256: string;
  target_path: string;
  target_sha256: string;
}>;

export type OriginalLongFormImmutableEvidenceRow = Readonly<{
  path: string;
  sha256: string;
}>;

const PRODUCT_ID = 'great_smoky_mountains_ridges_rivers_living_memory';

export const ORIGINAL_LONG_FORM_EXPECTED_SELECTION_KEYS = Object.freeze([
  `${PRODUCT_ID}:mountain_crossing:tn_to_nc`,
  `${PRODUCT_ID}:mountain_crossing:nc_to_tn`,
  `${PRODUCT_ID}:little_river_cades_cove:sugarlands_to_cades_cove_loop`,
  `${PRODUCT_ID}:roaring_fork:one_way`,
  `${PRODUCT_ID}:foothills_parkway:west_to_east`,
  `${PRODUCT_ID}:foothills_parkway:east_to_west`,
] as const);

export const ORIGINAL_LONG_FORM_EVIDENCE_ROWS: readonly OriginalLongFormEvidenceRow[] = Object.freeze([
  Object.freeze({
    key: `${PRODUCT_ID}:mountain_crossing:tn_to_nc`,
    kind: 'remaining',
    preflight_path: null,
    preflight_sha256: null,
    readiness_path: 'originals/smokies/mountain_crossing_tn_to_nc_delivery_readiness_v1.json',
    readiness_sha256: '05dd58aa92040f2815fdc1e8b5ddb352af1fbfa0263193093c49950359a5cfe8',
    target_path: 'originals/smokies/mountain_crossing_tn_to_nc_route_network_validation_target_v1.json',
    target_sha256: '1dd7704e476fd9df6aabe4b20771d62ddb9f1f2d257d838340757cec19fe7e2b',
  }),
  Object.freeze({
    key: `${PRODUCT_ID}:mountain_crossing:nc_to_tn`,
    kind: 'remaining',
    preflight_path: null,
    preflight_sha256: null,
    readiness_path: 'originals/smokies/mountain_crossing_nc_to_tn_delivery_readiness_v1.json',
    readiness_sha256: 'd416bf0c716434f3ee651fb8fd379ca01d082d438a16130d182cb3314d905e2d',
    target_path: 'originals/smokies/mountain_crossing_nc_to_tn_route_network_validation_target_v1.json',
    target_sha256: '6ba74de0ab77e9ff12aa4e52c54377533e95a92cbf9219a254b345676dccd7c5',
  }),
  Object.freeze({
    key: `${PRODUCT_ID}:little_river_cades_cove:sugarlands_to_cades_cove_loop`,
    kind: 'remaining',
    preflight_path: null,
    preflight_sha256: null,
    readiness_path: 'originals/smokies/little_river_cades_cove_loop_delivery_readiness_v1.json',
    readiness_sha256: '00abe0b8646332d27636856ab0c9029760d6b33f6ff4215d2364c17674b3fa90',
    target_path: 'originals/smokies/little_river_cades_cove_loop_route_network_validation_target_v1.json',
    target_sha256: '59ad07c506489c036c9ff26b94c3ec11e114e22c2dc5fd3ae5a402310797acd9',
  }),
  Object.freeze({
    key: `${PRODUCT_ID}:roaring_fork:one_way`,
    kind: 'roaring_fork',
    preflight_path: 'originals/smokies/roaring_fork_trigger_preflight_v1.json',
    preflight_sha256: 'b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3',
    readiness_path: 'originals/smokies/roaring_fork_delivery_readiness_v3.json',
    readiness_sha256: '423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01',
    target_path: 'originals/smokies/roaring_fork_route_network_validation_target_v1.json',
    target_sha256: 'f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119',
  }),
  Object.freeze({
    key: `${PRODUCT_ID}:foothills_parkway:west_to_east`,
    kind: 'remaining',
    preflight_path: null,
    preflight_sha256: null,
    readiness_path: 'originals/smokies/foothills_parkway_west_to_east_delivery_readiness_v1.json',
    readiness_sha256: '743719296433bb9528f88fe56aed158d8f08fb8af4a5c6fd42fc7f11610c5a6d',
    target_path: 'originals/smokies/foothills_parkway_west_to_east_route_network_validation_target_v1.json',
    target_sha256: 'f534a8289d2205fb3d1f0d23736cd50a771bad657e8e9e6c855a480672c7bc5f',
  }),
  Object.freeze({
    key: `${PRODUCT_ID}:foothills_parkway:east_to_west`,
    kind: 'remaining',
    preflight_path: null,
    preflight_sha256: null,
    readiness_path: 'originals/smokies/foothills_parkway_east_to_west_delivery_readiness_v1.json',
    readiness_sha256: '2eaafeb3573a8f15aed8b6ab68a660bc00e4807a6bd1b462e2fcb88aab4bd716',
    target_path: 'originals/smokies/foothills_parkway_east_to_west_route_network_validation_target_v1.json',
    target_sha256: '9598a7080733d1f33a5c01f608419bae28bcf24f7b9d37ed3a0c838efab26171',
  }),
]);

export const ORIGINAL_LONG_FORM_IMMUTABLE_EVIDENCE: readonly OriginalLongFormImmutableEvidenceRow[] = Object.freeze([
  Object.freeze({
    path: 'originals/smokies/roaring_fork_trigger_preflight_v1.json',
    sha256: 'b7b8412e07cdef5706d814550491f8c28bfadb05d3fbef38369ec7006c3b67f3',
  }),
  Object.freeze({
    path: 'originals/smokies/roaring_fork_delivery_readiness_v1.json',
    sha256: '4a0fc760fd07790785b820af06bac4e5a10e8337ad3f6257a10a3c50464c9b67',
  }),
  Object.freeze({
    path: 'originals/smokies/roaring_fork_delivery_readiness_v2.json',
    sha256: '7cf1b601d48845e3bc404a501d33a9f2c1e2567544c03347b99de0524ee923e6',
  }),
  Object.freeze({
    path: 'originals/smokies/roaring_fork_delivery_readiness_v3.json',
    sha256: '423866158fc5d1590419076a86f1632717b314c8647adfe6f604342f808abd01',
  }),
  Object.freeze({
    path: 'originals/smokies/roaring_fork_route_network_validation_target_v1.json',
    sha256: 'f29b9900158659dc53c15afe8d403b808b42a3bdef75f1c024232a6c683c5119',
  }),
  ...ORIGINAL_LONG_FORM_EVIDENCE_ROWS
    .filter(row => row.kind === 'remaining')
    .flatMap(row => [
      Object.freeze({ path: row.readiness_path, sha256: row.readiness_sha256 }),
      Object.freeze({ path: row.target_path, sha256: row.target_sha256 }),
    ]),
]);

function sortedUnique(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildOriginalLongFormEvidenceRegistry(
  rows: readonly OriginalLongFormEvidenceRow[] = ORIGINAL_LONG_FORM_EVIDENCE_ROWS,
) {
  const expected = [...ORIGINAL_LONG_FORM_EXPECTED_SELECTION_KEYS].sort();
  const keys = rows.map(row => row.key);
  const readinessPaths = rows.map(row => row.readiness_path);
  const targetPaths = rows.map(row => row.target_path);
  const registeredEvidencePaths = [
    ...readinessPaths,
    ...targetPaths,
    ...rows.flatMap(row => row.preflight_path ? [row.preflight_path] : []),
  ];
  if (
    rows.length !== expected.length
    || sortedUnique(keys).length !== rows.length
    || JSON.stringify(sortedUnique(keys)) !== JSON.stringify(expected)
    || sortedUnique(readinessPaths).length !== rows.length
    || sortedUnique(targetPaths).length !== rows.length
    || sortedUnique(registeredEvidencePaths).length !== registeredEvidencePaths.length
  ) {
    throw new Error('Checked long-form delivery evidence registry is incomplete or duplicated.');
  }
  for (const row of rows) {
    if (
      !row.key
      || !row.readiness_path
      || !row.target_path
      || !/^[a-f0-9]{64}$/.test(row.readiness_sha256)
      || !/^[a-f0-9]{64}$/.test(row.target_sha256)
      || (row.kind === 'roaring_fork') !== Boolean(row.preflight_path)
      || (row.kind === 'roaring_fork') !== Boolean(row.preflight_sha256)
    ) {
      throw new Error('Checked long-form delivery evidence registry row is invalid.');
    }
  }
  return new Map(rows.map(row => [row.key, row] as const));
}

export function checkedOriginalLongFormEvidence(
  productId: string,
  chapterId: string,
  variantId: string,
) {
  const key = `${productId}:${chapterId}:${variantId}`;
  const row = buildOriginalLongFormEvidenceRegistry().get(key);
  if (!row) {
    throw new Error('No checked long-form delivery evidence is registered for this chapter variant.');
  }
  return row;
}
