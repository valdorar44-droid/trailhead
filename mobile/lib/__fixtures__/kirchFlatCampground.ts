import type { CampsiteDetail, CampsitePin } from '../api';

export const kirchFlatSourceItemV1: CampsitePin = {
  id: 'place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8',
  place_id: 'place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8',
  provider_place_id: 'place:usfs:usfs-sierra-sites-83a6b34b-07f9-40a0-a98b-68de9b7b81a8',
  name: 'Kirch Flat Group Campground',
  lat: 36.87922085429918,
  lng: -119.14895040173735,
  tags: ['campground', 'usfs', 'forest service', 'Sierra National Forest', 'No Data'],
  land_type: 'usfs',
  description: 'At approximately 1,000 feet in elevation, Kirch Flat Campground resides on a large sandy flat area on the river edge of the scenic Kings River.',
  amenities: ['toilets'],
  site_types: ['campground'],
  photos: [{
    url: 'https://cdn.recreation.gov/public/2022/07/08/15/54/10182463_579ca7bd-50b9-49d7-8b0f-cef4e185ea41_700.webp',
    source: 'USDA Forest Service',
    caption: 'Kirch Flat Group Campground',
    credit: 'Recreation.gov',
  }],
  photo_url: 'https://cdn.recreation.gov/public/2022/07/08/15/54/10182463_579ca7bd-50b9-49d7-8b0f-cef4e185ea41_700.webp',
  reservable: true,
  url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0',
  official_url: 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0',
  booking_url: 'https://www.fs.usda.gov/recarea/sierra/recarea/?recid=45570',
  source: 'usfs',
  source_badge: 'USDA Forest Service',
  verified_source: 'USDA Forest Service',
  ada: false,
};

export const kirchFlatStoredDetailV1 = {
  ...kirchFlatSourceItemV1,
  requested_id: kirchFlatSourceItemV1.id,
  summary: kirchFlatSourceItemV1.description,
  cost: '',
  access_notes: 'Open',
  activities: [],
  campsites: [],
  campsites_count: 0,
  photos: kirchFlatSourceItemV1.photos,
  catalog_detail: true,
  planning_facts: [
    { key: 'place_type', label: 'Type', value: 'Campground' },
    { key: 'access', label: 'Access', value: 'Open' },
    { key: 'amenities', label: 'Amenities', value: 'toilets' },
  ],
} as CampsiteDetail & { catalog_detail: true; requested_id: string; summary: string };
