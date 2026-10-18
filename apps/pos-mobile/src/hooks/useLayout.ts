import { useWindowDimensions } from 'react-native';

/**
 * Layout breakpoints (DESIGN I3, I8).
 * - wide: rail on the left and a fixed bill panel on Jual. Tablet landscape (>= 900) or phone landscape
 *   (>= 700 wide and <= 520 tall).
 * - phoneLandscape: the keypad moves beside the amount, banner help text is hidden.
 * - columns: catalog grid. 2 under 600, 3 from 600 to 899, 4 on tablets. In phone landscape 3 when the space
 *   between the rail and the bill panel is at least 440, else 2 (the height is short, so more columns show more menu).
 */
export function useLayout() {
  const { width, height } = useWindowDimensions();
  const phoneLandscape = width >= 700 && height <= 520;
  const wide = width >= 900 || phoneLandscape;
  const tablet = wide && !phoneLandscape;
  const railWidth = phoneLandscape ? 86 : 108;
  const panelWidth = phoneLandscape ? 340 : 404;
  const columns = phoneLandscape ? (width - railWidth - panelWidth >= 440 ? 3 : 2) : width >= 900 ? 4 : width >= 600 ? 3 : 2;
  return { width, height, wide, tablet, phoneLandscape, columns, railWidth, panelWidth };
}
