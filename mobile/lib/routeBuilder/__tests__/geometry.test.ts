import { decodePolyline6 } from '../geometry';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`route geometry contract failed: ${message}`);
}

function encodeValue(value: number) {
  let shifted = value < 0 ? ~(value << 1) : value << 1;
  let encoded = '';
  while (shifted >= 0x20) {
    encoded += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
    shifted >>= 5;
  }
  return encoded + String.fromCharCode(shifted + 63);
}

function encodePolyline6(coords: [number, number][]) {
  let lastLat = 0;
  let lastLng = 0;
  return coords.map(([lng, lat]) => {
    const nextLat = Math.round(lat * 1e6);
    const nextLng = Math.round(lng * 1e6);
    const encoded = `${encodeValue(nextLat - lastLat)}${encodeValue(nextLng - lastLng)}`;
    lastLat = nextLat;
    lastLng = nextLng;
    return encoded;
  }).join('');
}

const expected: [number, number][] = [
  [-105.000001, 39.700001],
  [-104.950001, 39.750001],
  [-104.900001, 39.800001],
];
assert(JSON.stringify(decodePolyline6(encodePolyline6(expected))) === JSON.stringify(expected), 'valid provider shape decodes exactly');
assert(decodePolyline6('?').length === 0, 'truncated coordinate is rejected');
assert(decodePolyline6('_').length === 0, 'unterminated continuation is rejected');

console.log('route geometry tests passed');
