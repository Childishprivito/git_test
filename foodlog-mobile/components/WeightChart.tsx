// Weight trend: each weigh-in as a dot, the 7-day average as a line,
// and the goal (if set) as a dashed line. Tap the chart to read a day.
import { useState } from 'react';
import { GestureResponderEvent, Pressable, View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { T, useTheme } from '@/components/ui';
import type { Point } from '@/lib/weight';


const H = 170;
const PAD = { top: 10, bottom: 22, left: 40, right: 8 };
const dayMs = (d: string) => new Date(`${d}T12:00:00`).getTime();
const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function WeightChart({ points, goal }: { points: Point[]; goal: number | null }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<Point | null>(null);
  if (points.length === 0) return null;

  const values = points.flatMap((p) => [p.lb, p.avg]);
  if (goal) values.push(goal);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 4) {
    const mid = (hi + lo) / 2;
    lo = mid - 2;
    hi = mid + 2;
  }
  const x0 = dayMs(points[0].date);
  const x1 = Math.max(dayMs(points[points.length - 1].date), x0 + 864e5);
  const plotW = Math.max(1, w - PAD.left - PAD.right);
  const plotH = H - PAD.top - PAD.bottom;
  const x = (d: string) => PAD.left + ((dayMs(d) - x0) / (x1 - x0)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH;

  const pick = (e: GestureResponderEvent) => {
    const px = e.nativeEvent.locationX;
    let best = points[0];
    for (const p of points) if (Math.abs(x(p.date) - px) < Math.abs(x(best.date) - px)) best = p;
    setPicked(best);
  };

  const shown = picked ?? points[points.length - 1];
  return (
    <View>
      <T small muted>
        {`${short(shown.date)} · ${shown.lb.toFixed(1)} lb · 7-day avg ${shown.avg.toFixed(1)}`}
      </T>
      <Pressable
        accessibilityRole="image"
        accessibilityLabel={`Weight chart from ${short(points[0].date)} to ${short(points[points.length - 1].date)}: ${points[0].avg.toFixed(1)} to ${points[points.length - 1].avg.toFixed(1)} lb, 7-day average`}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onPressIn={pick}
        onTouchMove={pick}
        style={{ height: H, marginTop: 6 }}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {[hi, (hi + lo) / 2, lo].map((v) => (
              <Line key={v} x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} stroke={t.line} strokeWidth={1} />
            ))}
            {goal != null && (
              <Line x1={PAD.left} x2={w - PAD.right} y1={y(goal)} y2={y(goal)} stroke={t.muted} strokeWidth={1.5} strokeDasharray="5 4" />
            )}
            {picked && <Line x1={x(picked.date)} x2={x(picked.date)} y1={PAD.top} y2={H - PAD.bottom} stroke={t.muted} strokeWidth={1} />}
            {points.map((p) => (
              <Circle key={p.date} cx={x(p.date)} cy={y(p.lb)} r={p === picked ? 5 : 3.5} fill={t.soft} stroke={t.accent} strokeWidth={1} />
            ))}
            {points.length > 1 && (
              <Polyline points={points.map((p) => `${x(p.date)},${y(p.avg)}`).join(' ')} fill="none" stroke={t.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            )}
          </Svg>
        )}
        {/* Axis labels as text so they follow the app's fonts */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: PAD.left - 4 }}>
          <T small muted style={{ position: 'absolute', top: y(hi) - 9, right: 0 }}>{Math.round(hi)}</T>
          <T small muted style={{ position: 'absolute', top: y(lo) - 9, right: 0 }}>{Math.round(lo)}</T>
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: PAD.left, right: PAD.right, bottom: 0, flexDirection: 'row', justifyContent: 'space-between' }}>
          <T small muted>{short(points[0].date)}</T>
          <T small muted>{short(points[points.length - 1].date)}</T>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.soft, borderWidth: 1, borderColor: t.accent }} />
          <T small muted>Weigh-ins</T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 16, height: 2, backgroundColor: t.accent }} />
          <T small muted>7-day average</T>
        </View>
        {goal != null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 16, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: t.muted }} />
            <T small muted>{`Goal ${goal} lb`}</T>
          </View>
        )}
      </View>
    </View>
  );
}
