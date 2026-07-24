export type TripOverviewReturnState = {
  expanded: boolean;
  selectedDay: number | null;
  scrollOffset: number;
};

export function tripOverviewReturnState(input: {
  panelCollapsed: boolean;
  selectedDay: number | null;
  scrollOffset: number;
}): TripOverviewReturnState {
  const selectedDay = Number(input.selectedDay);
  const scrollOffset = Number(input.scrollOffset);
  return {
    expanded: !input.panelCollapsed,
    selectedDay: Number.isInteger(selectedDay) && selectedDay >= 1 ? selectedDay : null,
    scrollOffset: Number.isFinite(scrollOffset) ? Math.max(0, scrollOffset) : 0,
  };
}
