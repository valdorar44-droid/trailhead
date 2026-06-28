import type { MapActionRequest, RealtimeCopilotSessionResponse } from '@/lib/api';
import { disableRealtimeSpeakerphone, enableRealtimeSpeakerphone } from '@/lib/audioRoute';

type RealtimeCopilotHandle = {
  stop: () => void;
};

type StartRealtimeCopilotOptions = {
  tokenResponse: RealtimeCopilotSessionResponse;
  onStatus?: (status: string) => void;
  onMessage?: (message: string) => void;
  onUserTranscript?: (message: string) => void;
  onToolCall?: (action: MapActionRequest) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
};

function clientSecretValue(response: RealtimeCopilotSessionResponse): string {
  const secret = response.client_secret;
  if (typeof secret === 'string') return secret;
  if (secret && typeof secret.value === 'string') return secret.value;
  const direct = response.value;
  return typeof direct === 'string' ? direct : '';
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

type RealtimeToolCall = {
  action: MapActionRequest;
  callId: string;
};

function actionFromToolEvent(event: any): RealtimeToolCall | null {
  const item = event?.item || event?.output || event?.response?.output?.[0] || event;
  const name = item?.name || event?.name;
  const args = parseArguments(item?.arguments ?? event?.arguments);
  const callId = String(item?.call_id || event?.call_id || item?.id || event?.item_id || '');
  if (!callId) return null;
  if (name === 'trailhead_tool') {
    const tool = String(args.tool || '');
    if (!tool) return null;
    return {
      callId,
      action: {
        action_id: `realtime_${callId}_${Date.now()}`,
        action_type: 'trailheadTool',
        args: {
          tool,
          args: parseArguments(args.args),
        },
        requires_confirmation: false,
        cost_class: 'network',
        surface: 'copilot',
        provider: 'openai_realtime',
        status: 'staged',
        label: typeof args.label === 'string' ? args.label : tool.replace(/^trailhead\./, '').replace(/_/g, ' '),
      },
    };
  }
  if (name !== 'map_action') return null;
  const actionType = String(args.action_type || '');
  if (!actionType) return null;
  return {
    callId,
    action: {
      action_id: `realtime_${callId}_${Date.now()}`,
      action_type: actionType,
      args: parseArguments(args.args),
      requires_confirmation: args.requires_confirmation === true,
      cost_class: 'local',
      surface: 'map_layers',
      provider: 'openai_realtime',
      status: 'staged',
      label: typeof args.label === 'string' ? args.label : undefined,
    },
  };
}

function isCompletedToolCallEvent(event: any): boolean {
  return event?.type === 'response.output_item.done'
    || event?.type === 'response.function_call_arguments.done';
}

function sendRealtimeEvent(dc: any, event: Record<string, unknown>) {
  if (dc?.readyState !== 'open') return;
  dc.send(JSON.stringify(event));
}

function stringifyToolOutput(value: unknown): string {
  try {
    return JSON.stringify(value ?? { applied: true });
  } catch {
    return JSON.stringify({ applied: false, reason: 'unserializable_tool_result' });
  }
}

function redactCoordinateFields(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 8).map(item => redactCoordinateFields(item, depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^(lat|lng|lon|longitude|latitude|coordinates?|geometry|bbox|bounds|screen_x|screen_y|raw_feature|routeCoords)$/i.test(key)) continue;
    if (/(?:_id|id)$/i.test(key) && key !== 'result_id') continue;
    const redacted = redactCoordinateFields(entry, depth + 1);
    if (redacted !== undefined) out[key] = redacted;
  }
  return out;
}

function compactToolOutputSummary(output: Record<string, unknown> | void): string {
  if (!output) return 'The action was applied.';
  const selected = typeof output.selected === 'string' ? output.selected : '';
  const flownTo = typeof output.flown_to === 'string' ? output.flown_to : '';
  const opened = typeof output.opened === 'string' ? output.opened.replace(/_/g, ' ') : '';
  const count = Number(output.count);
  if (flownTo) return `Moved the map to ${flownTo}.`;
  if (selected) return `Selected ${selected}.`;
  if (opened) return `Opened ${opened}.`;
  if (Number.isFinite(count)) return `Found ${count} results.`;
  return 'The map action was applied.';
}

function compactRouteScoutSummary(output: Record<string, unknown> | void): string {
  const scout = output?.route_scout;
  if (!scout || typeof scout !== 'object') return '';
  const data = scout as Record<string, any>;
  const days = Number(data.days);
  const destination = typeof data.destinationName === 'string' ? data.destinationName.trim() : '';
  const plans = Array.isArray(data.dayPlans) ? data.dayPlans : [];
  const locked = plans.filter((plan: any) => String(plan?.campStatus || plan?.status || '').toLowerCase() === 'locked').length;
  const review = plans.filter((plan: any) => ['review', 'missing'].includes(String(plan?.campStatus || plan?.status || '').toLowerCase())).length;
  const head = Number.isFinite(days) && destination
    ? `Route scout ready: ${days} days to ${destination}.`
    : destination
      ? `Route scout ready for ${destination}.`
      : 'Route scout ready.';
  const details = locked || review
    ? ` ${locked} camp${locked === 1 ? '' : 's'} locked${review ? `, ${review} day${review === 1 ? '' : 's'} need review` : ''}.`
    : ' Review the day plan before navigation.';
  return `${head}${details}`;
}

function shouldIgnoreAssistantTranscript(text: string): boolean {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return true;
  const lower = clean.toLowerCase().replace(/[.!,\s]+$/g, '');
  if (lower.length <= 2) return true;
  return [
    'okay',
    'ok',
    'alright',
    'sure',
    'got it',
    'one moment',
    'let me check',
    'checking',
    'yes',
  ].includes(lower);
}

function toolResponseInstructions(output: Record<string, unknown> | void): string {
  const routeScoutSummary = compactRouteScoutSummary(output);
  if (routeScoutSummary) {
    return `The Trailhead route scout has already updated the app. Say exactly this and then stop: "${routeScoutSummary}" Do not repeat the full route summary. Do not call another tool unless the user asks a new follow-up.`;
  }
  const summary = typeof output?.spoken_summary === 'string' ? output.spoken_summary.trim() : '';
  if (summary) {
    return `The Trailhead map action has already been applied. Give a brief spoken confirmation based only on this result: "${summary}". Do not read coordinates, ids, or raw debug fields aloud unless the user explicitly asks. Do not call another tool unless the user asks a new follow-up.`;
  }
  const compact = compactToolOutputSummary(output);
  const safeOutput = stringifyToolOutput(redactCoordinateFields(output ?? {}));
  return `The Trailhead map action has already been applied. Say this briefly: "${compact}" Use this sanitized context only if needed: ${safeOutput}. Do not read coordinates, ids, or raw debug fields aloud unless the user explicitly asks. Do not call another tool unless the user asks a new follow-up.`;
}

function transcriptFromEvent(event: any): string {
  const type = String(event?.type || '');
  if (type.startsWith('conversation.item.input_audio_transcription') || type.startsWith('input_audio_buffer.')) return '';
  if (type === 'response.audio_transcript.done' && typeof event?.transcript === 'string') return event.transcript;
  if (type === 'response.output_audio_transcript.done' && typeof event?.transcript === 'string') return event.transcript;
  if (type === 'response.output_text.done' && typeof event?.text === 'string') return event.text;
  if (type === 'response.done' && typeof event?.response?.output_text === 'string') return event.response.output_text;
  if (!type && typeof event?.response?.output_text === 'string') return event.response.output_text;
  return '';
}

function userTranscriptFromEvent(event: any): string {
  if (event?.type !== 'conversation.item.input_audio_transcription.completed') return '';
  return typeof event?.transcript === 'string' ? event.transcript : '';
}

export async function startRealtimeCopilotSession(options: StartRealtimeCopilotOptions): Promise<RealtimeCopilotHandle> {
  const ephemeralKey = clientSecretValue(options.tokenResponse);
  if (!ephemeralKey) throw new Error('Realtime client secret missing');
  const WebRTC = require('react-native-webrtc');
  const { RTCPeerConnection, mediaDevices } = WebRTC;
  if (!RTCPeerConnection || !mediaDevices?.getUserMedia) throw new Error('Native WebRTC is not available in this build');

  options.onStatus?.('requesting_microphone');
  await enableRealtimeSpeakerphone();
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
  await enableRealtimeSpeakerphone();
  const pc = new RTCPeerConnection();
  const remoteStreams: any[] = [];
  stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
  pc.ontrack = (event: any) => {
    const remoteStream = event?.streams?.[0];
    if (remoteStream) remoteStreams.push(remoteStream);
    if (event?.track) event.track.enabled = true;
    enableRealtimeSpeakerphone().catch(() => {});
  };
  pc.onaddstream = (event: any) => {
    if (event?.stream) remoteStreams.push(event.stream);
    enableRealtimeSpeakerphone().catch(() => {});
  };

  const dc = pc.createDataChannel('oai-events');
  const handledToolCalls = new Set<string>();
  dc.onopen = () => {
    options.onStatus?.('connected');
    enableRealtimeSpeakerphone().catch(() => {});
    setTimeout(() => enableRealtimeSpeakerphone().catch(() => {}), 350);
    setTimeout(() => enableRealtimeSpeakerphone().catch(() => {}), 1000);
  };
  dc.onmessage = async (message: { data: string }) => {
    try {
      const event = JSON.parse(message.data);
      const userText = userTranscriptFromEvent(event);
      if (userText) options.onUserTranscript?.(userText);
      const text = transcriptFromEvent(event);
      if (text && !shouldIgnoreAssistantTranscript(text)) options.onMessage?.(text);
      if (isCompletedToolCallEvent(event)) {
        const toolCall = actionFromToolEvent(event);
        if (!toolCall || handledToolCalls.has(toolCall.callId)) return;
        handledToolCalls.add(toolCall.callId);
        let output: Record<string, unknown> | void;
        try {
          output = await options.onToolCall?.(toolCall.action);
        } catch (e: any) {
          output = { applied: false, error: e?.message || 'tool_call_failed' };
        }
        const toolOutput = output ?? { applied: true };
        sendRealtimeEvent(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: toolCall.callId,
            output: stringifyToolOutput(toolOutput),
          },
        });
        sendRealtimeEvent(dc, {
          type: 'response.create',
          response: {
            instructions: toolResponseInstructions(toolOutput as Record<string, unknown>),
          },
        });
      }
    } catch {
      // Ignore non-JSON data channel frames.
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const response = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ephemeralKey}`,
      'Content-Type': 'application/sdp',
    },
    body: offer.sdp,
  });
  if (!response.ok) {
    stream.getTracks().forEach((track: any) => track.stop());
    pc.close();
    disableRealtimeSpeakerphone().catch(() => {});
    throw new Error(`Realtime connection failed (${response.status})`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  await enableRealtimeSpeakerphone();

  return {
    stop: () => {
      try { dc.close(); } catch {}
      remoteStreams.forEach((remoteStream: any) => {
        remoteStream?.getTracks?.().forEach((track: any) => track.stop?.());
      });
      stream.getTracks().forEach((track: any) => track.stop());
      pc.close();
      disableRealtimeSpeakerphone().catch(() => {});
      options.onStatus?.('stopped');
    },
  };
}
