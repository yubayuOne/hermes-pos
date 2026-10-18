import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { colors } from '../theme';

/** Line icons drawn for HERMES POS (DESIGN A6, I4): 2px stroke, no icon library. */
export type IconName =
  | 'bell'
  | 'close'
  | 'menu'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'search'
  | 'trash'
  | 'sell'
  | 'bill'
  | 'shift'
  | 'more'
  | 'backspace'
  | 'offline'
  | 'alert'
  | 'plus'
  | 'minus'
  | 'check'
  | 'sync';

export function Icon({ name, size = 22, color = colors.ink, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const };
  const body = (() => {
    switch (name) {
      case 'bell':
        return (
          <>
            <Path d="M6 10a6 6 0 0 1 12 0v5l2 2H4l2-2z" {...p} />
            <Path d="M10 20h4" {...p} />
          </>
        );
      case 'close':
        return (
          <>
            <Line x1="6" y1="6" x2="18" y2="18" {...p} />
            <Line x1="18" y1="6" x2="6" y2="18" {...p} />
          </>
        );
      case 'menu':
        return (
          <>
            <Line x1="4" y1="7" x2="20" y2="7" {...p} />
            <Line x1="4" y1="12" x2="20" y2="12" {...p} />
            <Line x1="4" y1="17" x2="20" y2="17" {...p} />
          </>
        );
      case 'more':
        return (
          <>
            <Line x1="5" y1="7" x2="19" y2="7" {...p} />
            <Line x1="5" y1="12" x2="19" y2="12" {...p} />
            <Line x1="5" y1="17" x2="19" y2="17" {...p} />
          </>
        );
      case 'chevron-left':
        return <Polyline points="15,5 8,12 15,19" {...p} />;
      case 'chevron-right':
        return <Polyline points="9,5 16,12 9,19" {...p} />;
      case 'chevron-up':
        return <Polyline points="5,15 12,8 19,15" {...p} />;
      case 'chevron-down':
        return <Polyline points="5,9 12,16 19,9" {...p} />;
      case 'search':
        return (
          <>
            <Circle cx="11" cy="11" r="6" {...p} />
            <Line x1="15.5" y1="15.5" x2="20" y2="20" {...p} />
          </>
        );
      case 'trash':
        return (
          <>
            <Line x1="4" y1="7" x2="20" y2="7" {...p} />
            <Path d="M9 7V4h6v3" {...p} />
            <Path d="M6 7l1 13h10l1-13" {...p} />
            <Line x1="10" y1="11" x2="10" y2="16" {...p} />
            <Line x1="14" y1="11" x2="14" y2="16" {...p} />
          </>
        );
      case 'sell':
        return (
          <>
            <Rect x="4" y="4" width="7" height="7" {...p} />
            <Rect x="13" y="4" width="7" height="7" {...p} />
            <Rect x="4" y="13" width="7" height="7" {...p} />
            <Rect x="13" y="13" width="7" height="7" {...p} />
          </>
        );
      case 'bill':
        return (
          <>
            <Path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" {...p} />
            <Line x1="9" y1="8" x2="15" y2="8" {...p} />
            <Line x1="9" y1="12" x2="15" y2="12" {...p} />
          </>
        );
      case 'shift':
        return (
          <>
            <Rect x="3" y="8" width="18" height="12" {...p} />
            <Path d="M6 8V4h12v4" {...p} />
            <Line x1="10" y1="13" x2="14" y2="13" {...p} />
          </>
        );
      case 'backspace':
        return (
          <>
            <Path d="M9 5h11v14H9l-6-7z" {...p} />
            <Line x1="12" y1="9" x2="17" y2="14" {...p} />
            <Line x1="17" y1="9" x2="12" y2="14" {...p} />
          </>
        );
      case 'offline':
        return (
          <>
            <Path d="M7 18h10a4 4 0 0 0 1-7.9A6 6 0 0 0 6.3 9 4.5 4.5 0 0 0 7 18z" {...p} />
            <Line x1="4" y1="4" x2="20" y2="20" {...p} />
          </>
        );
      case 'alert':
        return (
          <>
            <Path d="M12 3l10 18H2z" {...p} />
            <Line x1="12" y1="10" x2="12" y2="14" {...p} />
            <Line x1="12" y1="17" x2="12" y2="18" {...p} />
          </>
        );
      case 'plus':
        return (
          <>
            <Line x1="12" y1="5" x2="12" y2="19" {...p} />
            <Line x1="5" y1="12" x2="19" y2="12" {...p} />
          </>
        );
      case 'minus':
        return <Line x1="5" y1="12" x2="19" y2="12" {...p} />;
      case 'check':
        return <Polyline points="5,12 10,17 19,7" {...p} />;
      case 'sync':
        return (
          <>
            <Path d="M20 11a8 8 0 0 0-14-5L4 8" {...p} />
            <Polyline points="4,3 4,8 9,8" {...p} />
            <Path d="M4 13a8 8 0 0 0 14 5l2-2" {...p} />
            <Polyline points="20,21 20,16 15,16" {...p} />
          </>
        );
    }
  })();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
