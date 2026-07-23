import type { NpsHubInput, NpsHubSelectionV1 } from '../support/npsHubPreservation';

export type NpsHubPreservationFixture = {
  name: 'gateway-direct' | 'yosemite-one-group' | 'yellowstone-two-groups';
  evidence: string[];
  input: NpsHubInput;
  expectedModuleKeys: string[];
  expectedGroupingDepth: number;
  omittedEmptyModuleKey: string;
  selection: NpsHubSelectionV1;
};

export const NPS_HUB_PRESERVATION_FIXTURES: NpsHubPreservationFixture[] = [
  {
    name: 'gateway-direct',
    evidence: [
      '43-gateway-what-to-see-list.xml',
      '44-gateway-monument-detail-top.xml',
      '48-gateway-list-return-from-detail.xml',
    ],
    input: {
      parkId: 'nps:gate',
      parkTitle: 'Gateway Arch National Park',
      modules: [
        {
          key: 'see',
          label: 'What to See',
          items: [
            { id: 'gate:gateway-arch-monument', label: 'Gateway Arch Monument', kind: 'place', lat: 38.6247, lng: -90.1848 },
            { id: 'gate:old-courthouse', label: 'Old Courthouse', kind: 'place', lat: 38.6251, lng: -90.1892 },
            { id: 'gate:visitor-center', label: 'Gateway Arch Visitor Center', kind: 'place', lat: 38.6245, lng: -90.1852 },
          ],
        },
        { key: 'geothermal', label: 'Geothermal Features', parkSpecific: true, items: [] },
      ],
    },
    expectedModuleKeys: ['see'],
    expectedGroupingDepth: 0,
    omittedEmptyModuleKey: 'geothermal',
    selection: {
      moduleKey: 'see',
      path: [],
      canonicalChildId: 'gate:visitor-center',
      listIndex: 2,
    },
  },
  {
    name: 'yosemite-one-group',
    evidence: [
      '08-yosemite-what-to-see-list.xml',
      '09-yosemite-valley-assets-list.xml',
      '11-yosemite-place-detail-top.xml',
      '13-yosemite-valley-return-from-detail.xml',
    ],
    input: {
      parkId: 'nps:yose',
      parkTitle: 'Yosemite National Park',
      modules: [
        {
          key: 'see',
          label: 'What to See',
          items: [
            {
              id: 'yose:area:yosemite-valley',
              label: 'Yosemite Valley',
              kind: 'group',
              children: [
                { id: 'yose:tunnel-view', label: 'Tunnel View', kind: 'place', lat: 37.7157, lng: -119.6777 },
                { id: 'yose:bridalveil-fall', label: 'Bridalveil Fall Viewing Area', kind: 'place', lat: 37.7169, lng: -119.6463 },
                { id: 'yose:swinging-bridge', label: 'Swinging Bridge', kind: 'place', lat: 37.7364, lng: -119.6004 },
              ],
            },
          ],
        },
        { key: 'caves', label: 'Caves', parkSpecific: true, items: [] },
      ],
    },
    expectedModuleKeys: ['see'],
    expectedGroupingDepth: 1,
    omittedEmptyModuleKey: 'caves',
    selection: {
      moduleKey: 'see',
      path: ['yose:area:yosemite-valley'],
      canonicalChildId: 'yose:tunnel-view',
      listIndex: 0,
    },
  },
  {
    name: 'yellowstone-two-groups',
    evidence: [
      '31-yellowstone-unique-hubs-target.xml',
      '32-yellowstone-areas-list.xml',
      '33-yellowstone-old-faithful-assets.xml',
      '34-yellowstone-upper-geyser-assets.xml',
      '35-yellowstone-geyser-place-detail.png',
    ],
    input: {
      parkId: 'nps:yell',
      parkTitle: 'Yellowstone National Park',
      modules: [
        {
          key: 'areas',
          label: 'Areas',
          parkSpecific: true,
          items: [
            {
              id: 'yell:area:old-faithful',
              label: 'Old Faithful and the Upper Geyser Basin',
              kind: 'group',
              children: [
                {
                  id: 'yell:area:upper-geyser-basin',
                  label: 'Upper Geyser Basin',
                  kind: 'group',
                  children: [
                    { id: 'yell:anemone-geysers', label: 'Anemone Geysers', kind: 'place', lat: 44.4614, lng: -110.8292 },
                    { id: 'yell:artemisia-geyser', label: 'Artemisia Geyser', kind: 'place', lat: 44.4664, lng: -110.8363 },
                    { id: 'yell:artemisia-trailhead', label: 'Artemisia Trailhead', kind: 'place', lat: 44.4659, lng: -110.8374 },
                  ],
                },
              ],
            },
          ],
        },
        {
          key: 'geothermal',
          label: 'Geysers & Hot Springs',
          parkSpecific: true,
          items: [
            { id: 'yell:old-faithful-geyser', label: 'Old Faithful Geyser', kind: 'place', lat: 44.4605, lng: -110.8281 },
          ],
        },
        { key: 'marine', label: 'Marine Life', parkSpecific: true, items: [] },
      ],
    },
    expectedModuleKeys: ['areas', 'geothermal'],
    expectedGroupingDepth: 2,
    omittedEmptyModuleKey: 'marine',
    selection: {
      moduleKey: 'areas',
      path: ['yell:area:old-faithful', 'yell:area:upper-geyser-basin'],
      canonicalChildId: 'yell:anemone-geysers',
      listIndex: 0,
    },
  },
];
