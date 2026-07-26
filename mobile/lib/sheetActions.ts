import type { CoordinatedSheetKind, SheetReturnContext } from './sheetCoordinator';

export type SheetActionEntityKindV1 =
  | 'campground'
  | 'trail'
  | 'trailhead'
  | 'fuel_service'
  | 'place'
  | 'nps_child'
  | 'community_report';

export type SheetActionIdV1 =
  | 'navigate'
  | 'save'
  | 'add_to_trip'
  | 'download'
  | 'preview_3d'
  | 'official_website'
  | 'booking'
  | 'phone'
  | 'share'
  | 'comments'
  | 'rating'
  | 'report'
  | 'report_full'
  | 'suggest_edit'
  | 'helpful'
  | 'not_accurate'
  | 'field_edit'
  | 'field_photo'
  | 'field_checked'
  | 'field_not_found'
  | 'field_publish';

export type SheetActionCapabilityV1 =
  | 'coordinates'
  | 'savable'
  | 'trip_edit'
  | 'offline_download'
  | 'route_geometry'
  | 'official_url'
  | 'booking_url'
  | 'phone_number'
  | 'shareable'
  | 'comments'
  | 'ratings'
  | 'reporting'
  | 'availability_report'
  | 'suggest_edit'
  | 'community_vote'
  | 'field_review'
  | 'field_photo'
  | 'admin_publish';

export type SheetActionDestinationV1 =
  | 'navigation'
  | 'saved_state'
  | 'trip_editor'
  | 'offline_manager'
  | 'preview_3d'
  | 'external_official'
  | 'external_booking'
  | 'native_phone'
  | 'native_share'
  | 'comments_section'
  | 'rating_section'
  | 'report_composer'
  | 'availability_report'
  | 'edit_form'
  | 'community_vote'
  | 'field_review';

export type SheetActionExpectedStateV1 = {
  sheet: 'preserve' | 'dismiss' | 'restore';
  map: 'preserve' | 'focus' | 'navigation';
  confirmation: 'none' | 'before_commit';
};

export type SheetActionDescriptorV1 = {
  id: SheetActionIdV1;
  entityKind: SheetActionEntityKindV1;
  requiredCapability: SheetActionCapabilityV1;
  available: boolean;
  unavailableReason?: string;
  label: string;
  destination: SheetActionDestinationV1;
  classification: 'safe' | 'mutating';
  returnContext: SheetReturnContext;
  expectedState: SheetActionExpectedStateV1;
};

export type SheetActionCapabilitiesV1 = Partial<Record<SheetActionCapabilityV1, boolean>>;

type ActionTemplate = Omit<
  SheetActionDescriptorV1,
  'entityKind' | 'available' | 'unavailableReason' | 'returnContext' | 'label'
> & {
  label: string | ((input: ResolveSheetActionsInputV1) => string);
};

export type ResolveSheetActionsInputV1 = {
  entityKind: SheetActionEntityKindV1;
  capabilities: SheetActionCapabilitiesV1;
  returnContext?: SheetReturnContext | null;
  saved?: boolean;
  privateFieldLead?: boolean;
};

const NAVIGATE: ActionTemplate = template(
  'navigate',
  'coordinates',
  input => input.entityKind === 'trailhead' || input.entityKind === 'nps_child' ? 'Directions' : 'Navigate',
  'navigation',
  'safe',
  { sheet: 'dismiss', map: 'navigation', confirmation: 'none' },
);
const SAVE: ActionTemplate = template(
  'save',
  'savable',
  input => input.saved ? 'Remove' : 'Save',
  'saved_state',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const ADD_TO_TRIP: ActionTemplate = template(
  'add_to_trip',
  'trip_edit',
  'Add to trip',
  'trip_editor',
  'mutating',
  { sheet: 'restore', map: 'preserve', confirmation: 'before_commit' },
);
const DOWNLOAD: ActionTemplate = template(
  'download',
  'offline_download',
  'Download',
  'offline_manager',
  'mutating',
  { sheet: 'restore', map: 'preserve', confirmation: 'before_commit' },
);
const PREVIEW_3D: ActionTemplate = template(
  'preview_3d',
  'route_geometry',
  'Preview in 3D',
  'preview_3d',
  'safe',
  { sheet: 'restore', map: 'focus', confirmation: 'none' },
);
const OFFICIAL: ActionTemplate = template(
  'official_website',
  'official_url',
  'Official website',
  'external_official',
  'safe',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const BOOKING: ActionTemplate = template(
  'booking',
  'booking_url',
  'Booking',
  'external_booking',
  'safe',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const PHONE: ActionTemplate = template(
  'phone',
  'phone_number',
  'Call',
  'native_phone',
  'safe',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const SHARE: ActionTemplate = template(
  'share',
  'shareable',
  'Share',
  'native_share',
  'safe',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const COMMENTS: ActionTemplate = template(
  'comments',
  'comments',
  'Comments',
  'comments_section',
  'safe',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const RATING: ActionTemplate = template(
  'rating',
  'ratings',
  'Rate',
  'rating_section',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const REPORT: ActionTemplate = template(
  'report',
  'reporting',
  'Report',
  'report_composer',
  'mutating',
  { sheet: 'restore', map: 'preserve', confirmation: 'before_commit' },
);
const REPORT_FULL: ActionTemplate = template(
  'report_full',
  'availability_report',
  'Report full',
  'availability_report',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const SUGGEST_EDIT: ActionTemplate = template(
  'suggest_edit',
  'suggest_edit',
  input => input.entityKind === 'community_report' ? 'Suggest update' : 'Suggest edit',
  'edit_form',
  'mutating',
  { sheet: 'restore', map: 'preserve', confirmation: 'before_commit' },
);
const HELPFUL: ActionTemplate = template(
  'helpful',
  'community_vote',
  'Helpful',
  'community_vote',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const NOT_ACCURATE: ActionTemplate = template(
  'not_accurate',
  'community_vote',
  'Not accurate',
  'community_vote',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'none' },
);
const FIELD_EDIT: ActionTemplate = template(
  'field_edit',
  'field_review',
  'Edit',
  'field_review',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const FIELD_PHOTO: ActionTemplate = template(
  'field_photo',
  'field_photo',
  'Photo',
  'field_review',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const FIELD_CHECKED: ActionTemplate = template(
  'field_checked',
  'field_review',
  'Checked',
  'field_review',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const FIELD_NOT_FOUND: ActionTemplate = template(
  'field_not_found',
  'field_review',
  'Not found',
  'field_review',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);
const FIELD_PUBLISH: ActionTemplate = template(
  'field_publish',
  'admin_publish',
  'Publish',
  'field_review',
  'mutating',
  { sheet: 'preserve', map: 'preserve', confirmation: 'before_commit' },
);

const COMMON_PLACE_ACTIONS = [
  NAVIGATE,
  SAVE,
  ADD_TO_TRIP,
  OFFICIAL,
  BOOKING,
  PHONE,
  SHARE,
  COMMENTS,
  RATING,
  REPORT,
  SUGGEST_EDIT,
] as const;

const REGISTRY: Record<SheetActionEntityKindV1, readonly ActionTemplate[]> = {
  campground: [
    NAVIGATE,
    SAVE,
    ADD_TO_TRIP,
    DOWNLOAD,
    PREVIEW_3D,
    OFFICIAL,
    BOOKING,
    PHONE,
    SHARE,
    COMMENTS,
    RATING,
    REPORT,
    REPORT_FULL,
    SUGGEST_EDIT,
  ],
  trail: [
    NAVIGATE,
    SAVE,
    ADD_TO_TRIP,
    DOWNLOAD,
    PREVIEW_3D,
    OFFICIAL,
    SHARE,
    RATING,
    REPORT,
    SUGGEST_EDIT,
  ],
  trailhead: [
    NAVIGATE,
    SAVE,
    ADD_TO_TRIP,
    DOWNLOAD,
    PREVIEW_3D,
    OFFICIAL,
    SHARE,
    RATING,
    REPORT,
    SUGGEST_EDIT,
  ],
  fuel_service: COMMON_PLACE_ACTIONS,
  place: COMMON_PLACE_ACTIONS,
  nps_child: [
    NAVIGATE,
    SAVE,
    ADD_TO_TRIP,
    OFFICIAL,
    BOOKING,
    PHONE,
    SHARE,
    COMMENTS,
    RATING,
    REPORT,
    SUGGEST_EDIT,
  ],
  community_report: [
    NAVIGATE,
    SAVE,
    SHARE,
    HELPFUL,
    NOT_ACCURATE,
    SUGGEST_EDIT,
    REPORT,
    FIELD_EDIT,
    FIELD_PHOTO,
    FIELD_CHECKED,
    FIELD_NOT_FOUND,
    FIELD_PUBLISH,
  ],
};

export function resolveSheetActionDescriptorsV1(
  input: ResolveSheetActionsInputV1,
): SheetActionDescriptorV1[] {
  const returnContext = input.returnContext ?? { surface: 'map' };
  return REGISTRY[input.entityKind].map(action => {
    const available = input.capabilities[action.requiredCapability] === true;
    return {
      id: action.id,
      entityKind: input.entityKind,
      requiredCapability: action.requiredCapability,
      available,
      ...(available ? {} : { unavailableReason: `Requires ${action.requiredCapability}` }),
      label: typeof action.label === 'function' ? action.label(input) : action.label,
      destination: action.destination,
      classification: action.classification,
      returnContext,
      expectedState: action.expectedState,
    };
  });
}

export function availableSheetActionsV1(input: ResolveSheetActionsInputV1) {
  return resolveSheetActionDescriptorsV1(input).filter(action => action.available);
}

export function sheetActionByIdV1(
  actions: readonly SheetActionDescriptorV1[],
  id: SheetActionIdV1,
) {
  return actions.find(action => action.id === id);
}

export function sheetActionTestIDV1(sheetTestID: string, actionId: SheetActionIdV1) {
  return `${sheetTestID}-action-${actionId.replace(/_/g, '-')}`;
}

export function inferSheetActionEntityKindV1(
  source: {
    type?: string | null;
    subtype?: string | null;
    display_type?: string | null;
    source?: string | null;
    source_label?: string | null;
  },
  coordinatedKind?: CoordinatedSheetKind,
): SheetActionEntityKindV1 {
  if (coordinatedKind === 'camp') return 'campground';
  if (coordinatedKind === 'trail') return 'trail';
  if (coordinatedKind === 'trailhead') return 'trailhead';
  if (coordinatedKind === 'community_report') return 'community_report';
  const text = [
    source.type,
    source.subtype,
    source.display_type,
    source.source,
    source.source_label,
  ].filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ');
  if (/\b(?:camp|campground|campsite|rv park)\b/.test(text)) return 'campground';
  if (/\btrailhead\b/.test(text)) return 'trailhead';
  if (/\btrail\b/.test(text)) return 'trail';
  if (/\b(?:fuel|gas|service station|grocery|market|dump station|repair|mechanic|parking)\b/.test(text)) {
    return 'fuel_service';
  }
  if (/\b(?:nps|national park service)\b/.test(text)) return 'nps_child';
  return 'place';
}

function template(
  id: SheetActionIdV1,
  requiredCapability: SheetActionCapabilityV1,
  label: ActionTemplate['label'],
  destination: SheetActionDestinationV1,
  classification: SheetActionDescriptorV1['classification'],
  expectedState: SheetActionExpectedStateV1,
): ActionTemplate {
  return {
    id,
    requiredCapability,
    label,
    destination,
    classification,
    expectedState,
  };
}
