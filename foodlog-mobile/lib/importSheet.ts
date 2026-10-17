// Import a workout program from an .ods/.xlsx spreadsheet (mirrors
// foodlog-core/src/sheet.rs + workout::import). Read on the phone only.
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Day, Exercise, LoggedSet, Program } from './model';
import { parseLoadReps } from './workout';

interface Cell {
  text: string;
  link?: string;
}
type Grid = Cell[][];
const MAX_REPEAT = 64;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,
  trimValues: false,
  processEntities: true,
});

type Node = Record<string, any>;
const tag = (n: Node) => Object.keys(n).find((k) => k !== ':@')!;
const kids = (n: Node): Node[] => (Array.isArray(n[tag(n)]) ? n[tag(n)] : []);
const attr = (n: Node, a: string): string | undefined => n[':@']?.[`@${a}`];

function walk(nodes: Node[], visit: (n: Node) => boolean | void) {
  for (const n of nodes) if (visit(n) !== false) walk(kids(n), visit);
}

/** Text of an ODS cell: paragraphs joined with newlines, <text:s/> as spaces. */
function odsText(cell: Node): Cell {
  let link: string | undefined;
  const paras: string[] = [];
  const inline = (nodes: Node[]): string =>
    nodes
      .map((n) => {
        const t = tag(n);
        if (t === '#text') return String(n['#text']);
        if (t === 'text:s') return ' '.repeat(Number(attr(n, 'text:c') ?? 1));
        if (t === 'text:line-break') return '\n';
        if (t === 'text:tab') return '\t';
        if (t === 'text:a') link ??= attr(n, 'xlink:href');
        return inline(kids(n));
      })
      .join('');
  for (const p of kids(cell)) if (tag(p) === 'text:p') paras.push(inline(kids(p)));
  return { text: paras.join('\n').trim(), link };
}

function readOds(xml: string): Grid {
  const doc = parser.parse(xml) as Node[];
  let table: Node | undefined;
  walk(doc, (n) => {
    if (!table && tag(n) === 'table:table') {
      table = n;
      return false;
    }
  });
  const grid: Grid = [];
  if (!table) return grid;
  walk(kids(table), (n) => {
    if (tag(n) !== 'table:table-row') return;
    const row: Cell[] = [];
    for (const c of kids(n)) {
      const t = tag(c);
      if (t !== 'table:table-cell' && t !== 'table:covered-table-cell') continue;
      const cell = odsText(c);
      let rep = Number(attr(c, 'table:number-columns-repeated') ?? 1);
      if (!cell.text && rep > MAX_REPEAT) rep = 1;
      for (let i = 0; i < rep; i++) row.push(cell);
    }
    while (row.length && !row[row.length - 1].text && !row[row.length - 1].link) row.pop();
    let rows = Number(attr(n, 'table:number-rows-repeated') ?? 1);
    if (!row.length) rows = Math.min(rows, MAX_REPEAT);
    for (let i = 0; i < rows; i++) grid.push(row);
    return false;
  });
  return grid;
}

function readXlsx(sheet: string, shared: string[]): Grid {
  const p = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    htmlEntities: true,
    isArray: (n) => ['row', 'c', 'si', 'r'].includes(n),
  });
  const doc = p.parse(sheet);
  const grid: Grid = [];
  for (const row of doc?.worksheet?.sheetData?.row ?? []) {
    for (const c of row.c ?? []) {
      const m = /^([A-Z]+)(\d+)$/.exec(c['@r'] ?? '');
      if (!m) continue;
      const col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const r = Number(m[2]) - 1;
      const raw = c.v ?? c.is?.t ?? '';
      const text = c['@t'] === 's' ? shared[Number(raw)] ?? '' : String(raw);
      (grid[r] ??= [])[col] = { text: text.trim() };
    }
  }
  return Array.from(grid, (r) => Array.from(r ?? [], (c) => c ?? { text: '' }));
}

function sharedStrings(xml: string): string[] {
  const p = new XMLParser({ ignoreAttributes: true, htmlEntities: true, isArray: (n) => ['si', 'r'].includes(n) });
  const text = (v: any): string => (typeof v === 'object' && v ? String(v['#text'] ?? '') : String(v ?? ''));
  return (p.parse(xml)?.sst?.si ?? []).map((si: any) =>
    si.t != null ? text(si.t) : (si.r ?? []).map((r: any) => text(r.t)).join(''),
  );
}

export async function readSheet(bytes: ArrayBuffer | Uint8Array): Promise<Grid> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("That file isn't a spreadsheet (.ods or .xlsx).");
  }
  const content = await zip.file('content.xml')?.async('string');
  if (content) return readOds(content);
  const sheet = await zip.file('xl/worksheets/sheet1.xml')?.async('string');
  if (sheet) {
    const shared = await zip.file('xl/sharedStrings.xml')?.async('string');
    return readXlsx(sheet, shared ? sharedStrings(shared) : []);
  }
  throw new Error("Couldn't find a sheet in that file.");
}

/** Spreadsheets turn "2-3" into a date; Excel stores it as a day number. Turn it back. */
export function warmupText(s: string): string {
  if (!/^\d{5}$/.test(s)) return s;
  const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
  return `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

const tidyBlock = (s: string) => {
  const l = s.trim().toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
};

/** Rows like "Week N | Exercise | …", day name in column A of a day's first exercise. */
export function importProgram(grid: Grid, name: string, firstId: number): { program: Program; sets: LoggedSet[] } {
  const program: Program = { name, weeks: [] };
  const sets: LoggedSet[] = [];
  const text = (r: Cell[], c: number | undefined) => (c != null && c >= 0 ? (r[c]?.text ?? '').trim() : '');
  let block = '';
  let nextId = firstId;
  let i = 0;
  while (i < grid.length) {
    const row = grid[i] ?? [];
    const a = text(row, 0);
    if (a.toUpperCase().startsWith('BLOCK')) block = tidyBlock(a);
    const weekNo = /^Week\s*(\d+)$/.exec(a)?.[1];
    const exCol = row.findIndex((c) => c?.text.trim().toLowerCase() === 'exercise');
    if (!weekNo || exCol < 0) {
      i++;
      continue;
    }
    const find = (...words: string[]) => row.findIndex((c) => words.every((w) => c?.text.toLowerCase().includes(w)));
    const col = {
      tech: find('technique'),
      warm: find('warm'),
      work: find('working'),
      reps: row.findIndex((c) => c?.text.trim().toLowerCase() === 'reps'),
      early: find('early', 'rpe'),
      last: find('last set', 'rpe'),
      rest: find('rest'),
      sub1: find('substitution', '1'),
      sub2: find('substitution', '2'),
      notes: find('notes'),
    };
    const next = grid[i + 1] ?? [];
    const setCols = next.flatMap((c, j) => (c?.text.trim().toLowerCase().startsWith('set ') ? [j] : []));
    if (setCols.length) i++;
    const wn = Number(weekNo);
    let week = program.weeks.find((w) => w.number === wn);
    if (!week) program.weeks.push((week = { number: wn, block, days: [] }));
    i++;
    for (; i < grid.length; i++) {
      const r = grid[i] ?? [];
      const dayCell = text(r, 0);
      if (dayCell.startsWith('Week') || dayCell.toUpperCase().startsWith('BLOCK')) break;
      if (dayCell.toLowerCase().includes('rest day')) continue;
      if (dayCell) week.days.push({ name: dayCell.split(/\s+/).join(' '), exercises: [] });
      const day: Day | undefined = week.days[week.days.length - 1];
      const exName = text(r, exCol);
      if (!day || !exName) continue;
      const technique = text(r, col.tech);
      const ex: Exercise = {
        name: exName,
        video: r[exCol]?.link ?? null,
        technique: technique.toLowerCase() === 'n/a' ? '' : technique,
        warmup_sets: warmupText(text(r, col.warm)),
        working_sets: parseInt(text(r, col.work), 10) || 0,
        reps: text(r, col.reps),
        early_rpe: text(r, col.early),
        last_rpe: text(r, col.last),
        rest: text(r, col.rest),
        substitutions: [text(r, col.sub1), text(r, col.sub2)].filter((s) => s && !s.toLowerCase().startsWith('see ')),
        notes: text(r, col.notes),
      };
      for (const c of setCols) {
        const lr = parseLoadReps(text(r, c));
        if (lr) sets.push({ id: nextId++, date: '', exercise: exName, weight: lr[0], reps: lr[1], week: wn, day: day.name });
      }
      day.exercises.push(ex);
    }
  }
  program.weeks.sort((a, b) => a.number - b.number);
  if (program.weeks.every((w) => !w.days.length)) {
    throw new Error('Couldn\'t find any weeks in that sheet. It needs rows like "Week 1 | Exercise | …".');
  }
  return { program, sets };
}
