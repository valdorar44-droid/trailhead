import type { MapActionRequest, RealtimeCopilotSessionResponse } from '@/lib/api';
import { disableRealtimeSpeakerphone, enableRealtimeSpeakerphone } from '@/lib/audioRoute';

type RealtimeCopilotHandle = {
  stop: () => void;
};

type StartRealtimeCopilotOptions = {
  tokenResponse: RealtimeCopilotSessionResponse;
  onStatus?: (status: string) => void;
  onMessage?: (message: string) => void;
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
  if (name !== 'map_action') return null;
  const args = parseArguments(item?.arguments ?? event?.arguments);
  const actionType = String(args.action_type || '');
  if (!actionType) return null;
  const callId = String(item?.call_id || event?.call_id || item?.id || event?.item_id || '');
  if (!callId) return null;
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

function transcriptFromEvent(event: any): string {
  const type = String(event?.type || '');
  if (type.startsWith('conversation.item.input_audio_transcription') || type.startsWith('input_audio_buffer.')) return '';
  if (type === 'response.audio_transcript.done' && typeof event?.transcript === 'string') return event.transcript;
  if (type === 'response.output_text.done' && typeof event?.text === 'string') return event.text;
  if (type === 'response.done' && typeof event?.response?.output_text === 'string') return event.response.output_text;
  if (!type && typeof event?.response?.output_text === 'string') return event.response.output_text;
  return '';
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
      const text = transcriptFromEvent(event);
      if (text) options.onMessage?.(text);
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
        sendRealtimeEvent(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: toolCall.callId,
            output: stringifyToolOutput(output ?? { applied: true }),
          },
        });
        sendRealtimeEvent(dc, { type: 'response.create' });
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
