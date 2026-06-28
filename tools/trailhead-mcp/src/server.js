#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const CONTRACT_VERSION = 'trailhead-copilot-tools-v1';
const API_BASE = (process.env.TRAILHEAD_API_BASE || 'https://api.gettrailhead.app').replace(/\/+$/, '');
const API_TOKEN = process.env.TRAILHEAD_API_TOKEN || '';
const API_PATH = process.env.TRAILHEAD_API_PATH || '/api/copilot/tools/execute';

const toolSchemas = {
  'trailhead.visible_map_context': {
    type: 'object',
    additionalProperties: true,
    properties: {
      snapshot: { type: 'object' },
      center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      bounds: { type: 'object', properties: { n: { type: 'number' }, s: { type: 'number' }, e: { type: 'number' }, w: { type: 'number' } } },
      visible_features: { type: 'array', items: { type: 'object' } },
      current_results: { type: 'array', items: { type: 'object' } },
      route: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
    },
  },
  'trailhead.search_places': {
    type: 'object',
    additionalProperties: true,
    properties: {
      q: { type: 'string' },
      query: { type: 'string' },
      category: { type: 'string' },
      keyword: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      bbox: { type: 'string' },
      proximity: { type: 'string' },
      snapshot: { type: 'object' },
    },
  },
  'trailhead.resolve_place': {
    type: 'object',
    additionalProperties: true,
    properties: {
      q: { type: 'string' },
      query: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      country: { type: 'string' },
      types: { type: 'string' },
      snapshot: { type: 'object' },
    },
  },
  'trailhead.reverse_geocode': {
    type: 'object',
    additionalProperties: true,
    properties: {
      lat: { type: 'number' },
      lng: { type: 'number' },
      point: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      country: { type: 'string' },
      types: { type: 'string' },
    },
  },
  'trailhead.route_preview': {
    type: 'object',
    additionalProperties: true,
    properties: {
      coordinates: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      locations: { type: 'array', items: { type: 'object' } },
      profile: { type: 'string' },
      exclude: { type: 'string' },
      units: { type: 'string' },
    },
  },
  'trailhead.route_matrix': {
    type: 'object',
    additionalProperties: true,
    properties: {
      coordinates: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      locations: { type: 'array', items: { type: 'object' } },
      profile: { type: 'string' },
      sources: { type: 'string' },
      destinations: { type: 'string' },
      annotations: { type: 'string' },
    },
  },
  'trailhead.discovery_context': {
    type: 'object',
    additionalProperties: true,
    properties: {
      bounds: { type: 'object', properties: { n: { type: 'number' }, s: { type: 'number' }, e: { type: 'number' }, w: { type: 'number' } } },
      center: { type: 'object', properties: { lat: { type: 'number' }, lng: { type: 'number' } } },
      snapshot: { type: 'object' },
      radius: { type: 'number' },
      categories: { type: 'array', items: { type: 'string' } },
      filters: { type: 'array', items: { type: 'string' } },
      route: { type: 'array', items: { type: 'array', items: { type: 'number' } } },
      surface: { type: 'string' },
      mode: { type: 'string', enum: ['light', 'full'] },
      limit: { type: 'integer' },
      include_stays: { type: 'boolean' },
      force_refresh: { type: 'boolean' },
    },
  },
};

const descriptions = {
  'trailhead.visible_map_context': 'Normalize the current Trailhead map snapshot and visible map context.',
  'trailhead.search_places': 'Search Mapbox-backed places through Trailhead temporary-use map context.',
  'trailhead.resolve_place': 'Resolve a named place, address, landmark, or POI through Trailhead.',
  'trailhead.reverse_geocode': 'Resolve a lat/lng point to nearby place candidates through Trailhead.',
  'trailhead.route_preview': 'Build a temporary route preview and Trailhead route-build shape.',
  'trailhead.route_matrix': 'Build a temporary travel-time and distance matrix.',
  'trailhead.discovery_context': 'Read Trailhead discovery context for camps, stays, places, and map packs.',
};

const tools = Object.keys(toolSchemas).sort().map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: toolSchemas[name],
  annotations: {
    title: name.replace(/^trailhead\./, '').replace(/_/g, ' '),
    readOnlyHint: true,
    destructiveHint: false,
  },
}));

function authHeaders() {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

async function callTrailhead(tool, args) {
  const response = await fetch(`${API_BASE}${API_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      tool,
      args: args || {},
      metadata: {
        caller: 'trailhead-local-mcp',
        contract: CONTRACT_VERSION,
      },
    }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload,
    };
  }
  return payload;
}

const server = new Server(
  {
    name: 'trailhead-local-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params?.name;
  if (!Object.prototype.hasOwnProperty.call(toolSchemas, name)) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown Trailhead tool: ${name}`);
  }
  const args = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const result = await callTrailhead(name, args);
  return {
    isError: result.ok === false,
    content: [
      {
        type: 'text',
        text: jsonText(result),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
