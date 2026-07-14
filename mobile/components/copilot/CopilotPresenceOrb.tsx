import { TrailheadWayfinder } from './TrailheadWayfinder';

export type CopilotPresenceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'building'
  | 'flying'
  | 'speaking'
  | 'warning'
  | 'paused'
  | 'complete';

type Props = {
  state: CopilotPresenceState;
  /** @deprecated The wayfinder no longer displays launcher captions. */
  label?: string;
};

export function CopilotPresenceOrb({ state }: Props) {
  return <TrailheadWayfinder state={state} size={56} testID="copilot-presence-wayfinder" />;
}
