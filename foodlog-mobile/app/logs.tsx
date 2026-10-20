// Logs: what the app did and what went wrong, newest first.
// Share them (e.g. paste into a chat with Claude) to diagnose a problem.
import { useEffect, useState } from 'react';
import { FlatList, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Segmented, T, styles, useTheme } from '@/components/ui';
import { LogLine, clearLog, formatLog, getLog, loadLog, onLog } from '@/lib/log';

type Filter = 'all' | 'problems';

export default function Logs() {
  const t = useTheme();
  const [lines, setLines] = useState<LogLine[]>(getLog());
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    loadLog().then(() => setLines([...getLog()]));
    return onLog(() => setLines([...getLog()]));
  }, []);

  const shown = (filter === 'all' ? lines : lines.filter((l) => l.level !== 'info')).slice().reverse();
  const problems = lines.filter((l) => l.level !== 'info').length;
  const color = (l: LogLine) => (l.level === 'error' ? t.danger : l.level === 'warn' ? t.over : t.muted);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['bottom']}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Segmented<Filter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All (${lines.length})` },
            { value: 'problems', label: `Problems (${problems})` },
          ]}
        />
        <View style={[styles.row, { marginVertical: 10 }]}>
          <Button
            kind="primary"
            title="Share logs"
            onPress={() => Share.share({ message: `FoodLog logs (newest last)\n\n${formatLog(lines.slice(-200))}` })}
          />
          <Button kind="ghost" title="Clear" onPress={clearLog} />
        </View>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(l, i) => `${l.t}-${i}`}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }}
        ListEmptyComponent={<T muted>Nothing logged yet.</T>}
        renderItem={({ item: l }) => (
          <View style={{ borderTopWidth: 1, borderColor: t.line, paddingVertical: 8 }}>
            <View style={styles.row}>
              <T small bold style={{ color: color(l) }}>{`${l.level.toUpperCase()} · ${l.area}`}</T>
              <T small muted>{new Date(l.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</T>
            </View>
            <T small>{l.msg}</T>
            {!!l.data && <T small muted style={{ marginTop: 2 }}>{l.data}</T>}
          </View>
        )}
      />
    </SafeAreaView>
  );
}
