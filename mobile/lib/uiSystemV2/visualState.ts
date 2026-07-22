import type { UiV2SemanticColors } from '../theme/uiV2';

export type UiV2ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type UiV2ChipState = 'default' | 'selected' | 'disabled' | 'error';
export type PlaceSheetPosition = 'peek' | 'half' | 'full';
export type PlaceSheetContentState = 'ready' | 'loading' | 'refreshing' | 'offline' | 'error';

export interface UiV2ControlVisual {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  opacity: number;
}

export function resolveButtonVisual(
  colors: Readonly<UiV2SemanticColors>,
  variant: UiV2ButtonVariant,
  options: { pressed?: boolean; disabled?: boolean } = {},
): UiV2ControlVisual {
  if (variant === 'primary') {
    return {
      backgroundColor: options.pressed ? colors.accentText : colors.accentFill,
      borderColor: options.pressed ? colors.accentText : colors.accentFill,
      textColor: colors.textOnAccent,
      opacity: options.disabled ? 0.48 : 1,
    };
  }
  if (variant === 'ghost') {
    return {
      backgroundColor: options.pressed ? colors.surfacePressed : 'transparent',
      borderColor: 'transparent',
      textColor: colors.accentText,
      opacity: options.disabled ? 0.48 : 1,
    };
  }
  return {
    backgroundColor: options.pressed ? colors.surfacePressed : colors.surface,
    borderColor: colors.borderStrong,
    textColor: colors.textPrimary,
    opacity: options.disabled ? 0.48 : 1,
  };
}

export function resolveChipVisual(
  colors: Readonly<UiV2SemanticColors>,
  state: UiV2ChipState,
  pressed = false,
): UiV2ControlVisual {
  if (state === 'error') {
    return {
      backgroundColor: colors.errorSurface,
      borderColor: colors.errorBorder,
      textColor: colors.errorText,
      opacity: 1,
    };
  }
  if (state === 'selected') {
    return {
      backgroundColor: pressed ? colors.accentFill : colors.accentSoft,
      borderColor: colors.accentText,
      textColor: pressed ? colors.textOnAccent : colors.accentText,
      opacity: 1,
    };
  }
  return {
    backgroundColor: pressed ? colors.surfacePressed : colors.surface,
    borderColor: colors.border,
    textColor: colors.textSecondary,
    opacity: state === 'disabled' ? 0.48 : 1,
  };
}

export function resolvePlaceSheetHeight(position: PlaceSheetPosition, viewportHeight: number): number {
  const safeHeight = Math.max(320, viewportHeight);
  if (position === 'peek') return Math.max(220, Math.round(safeHeight * 0.31));
  if (position === 'half') return Math.max(360, Math.round(safeHeight * 0.58));
  return Math.max(500, Math.round(safeHeight * 0.92));
}

export function placeSheetShowsContent(state: PlaceSheetContentState): boolean {
  return state === 'ready' || state === 'refreshing' || state === 'offline';
}
