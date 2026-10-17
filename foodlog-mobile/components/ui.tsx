// Small building blocks with the app's look, light and dark.
import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
  useColorScheme,
} from 'react-native';

export const palette = {
  light: { bg: '#f6f7f9', card: '#ffffff', text: '#16181d', muted: '#5b6270', line: '#e3e6eb', accent: '#0f766e', accentText: '#ffffff', soft: '#d8f0ed', danger: '#b42318', over: '#c2410c' },
  dark: { bg: '#0e1013', card: '#181b20', text: '#eef0f3', muted: '#a3aab6', line: '#2a2f37', accent: '#2dd4bf', accentText: '#04221f', soft: '#123b37', danger: '#f97066', over: '#fb923c' },
};
export type Theme = typeof palette.light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.line }, style]}>{children}</View>;
}

export function T({
  children,
  muted,
  small,
  bold,
  size,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  small?: boolean;
  bold?: boolean;
  size?: number;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        { color: muted ? t.muted : t.text, fontSize: size ?? (small ? 14 : 17), fontWeight: bold ? '700' : '400' },
        style,
      ]}>
      {children}
    </Text>
  );
}

export function H({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 }) {
  return (
    <T bold size={level === 1 ? 28 : 19} style={{ marginBottom: 6 }}>
      <Text accessibilityRole="header">{children}</Text>
    </T>
  );
}

export function Button({
  title,
  onPress,
  kind = 'default',
  big,
  busy,
  disabled,
  label,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: 'default' | 'primary' | 'ghost' | 'danger';
  big?: boolean;
  busy?: boolean;
  disabled?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'default' ? t.card : 'transparent';
  const fg = kind === 'primary' ? t.accentText : kind === 'ghost' ? t.accent : kind === 'danger' ? t.danger : t.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!(disabled || busy), busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'default' ? t.line : 'transparent', minHeight: big ? 58 : 46 },
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '600', fontSize: big ? 19 : 17 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hideLabel?: boolean }) {
  const t = useTheme();
  const { label, hideLabel, style, ...rest } = props;
  return (
    <View style={{ marginTop: hideLabel ? 0 : 10, flexGrow: style ? 0 : 1, flexShrink: 1 }}>
      {!hideLabel && <T bold style={{ marginBottom: 6 }}>{label}</T>}
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        style={[styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.line }, style]}
        {...rest}
      />
    </View>
  );
}

export function Bar({ label, value, goal, unit }: { label: string; value: number; goal: number; unit: string }) {
  const t = useTheme();
  const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
  const over = goal > 0 && value > goal;
  return (
    <View
      style={{ marginTop: 10 }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: Math.round(goal), now: Math.round(value) }}>
      <View style={styles.row}>
        <T small>{label}</T>
        <T small muted>
          {`${Math.round(value)} / ${Math.round(goal)} ${unit}${over ? ' · over' : ''}`}
        </T>
      </View>
      <View style={[styles.barTrack, { backgroundColor: t.soft }]}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 99, backgroundColor: over ? t.over : t.accent }} />
      </View>
    </View>
  );
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.seg, { borderColor: t.line }]}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segItem,
              { backgroundColor: on ? t.accent : t.card, borderLeftWidth: i ? 1 : 0, borderColor: t.line },
            ]}>
            <Text style={{ color: on ? t.accentText : t.text, fontWeight: on ? '700' : '400', textAlign: 'center' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  button: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 46, paddingHorizontal: 12, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  barTrack: { height: 10, borderRadius: 99, overflow: 'hidden', marginTop: 4 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden', marginTop: 8 },
  segItem: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  screen: { padding: 16, paddingBottom: 40 },
});
