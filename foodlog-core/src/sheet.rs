//! Reading the first sheet of an .ods or .xlsx file into a grid of cells.
//! Only what a workout program needs: each cell's text and link.

use std::io::{Cursor, Read};

use quick_xml::{
    Reader,
    events::{BytesStart, Event},
};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Cell {
    pub text: String,
    /// e.g. a video link on an exercise name.
    pub link: Option<String>,
}

pub type Grid = Vec<Vec<Cell>>;

/// Big blocks of repeated empty rows/columns (common at the end of .ods sheets)
/// are skipped instead of expanded.
const MAX_REPEAT: usize = 64;

pub fn read(bytes: &[u8]) -> Result<Grid, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "That file isn't a spreadsheet (.ods or .xlsx).".to_string())?;
    let mut file = |name: &str| -> Option<String> {
        let mut s = String::new();
        zip.by_name(name).ok()?.read_to_string(&mut s).ok()?;
        Some(s)
    };
    if let Some(content) = file("content.xml") {
        return Ok(read_ods(&content));
    }
    if let Some(sheet) = file("xl/worksheets/sheet1.xml") {
        let shared = file("xl/sharedStrings.xml").map(|s| shared_strings(&s)).unwrap_or_default();
        return Ok(read_xlsx(&sheet, &shared));
    }
    Err("Couldn't find a sheet in that file.".into())
}

#[allow(deprecated)] // `unescape_value` still does exactly what we need.
fn attr(e: &BytesStart, name: &str) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

fn repeat(e: &BytesStart, name: &str) -> usize {
    attr(e, name).and_then(|v| v.parse().ok()).unwrap_or(1).max(1)
}

/// OpenDocument (.ods, LibreOffice / Numbers export).
pub fn read_ods(xml: &str) -> Grid {
    let mut r = Reader::from_str(xml);
    let mut grid: Grid = Vec::new();
    let mut in_first_table = false;
    let mut tables = 0;
    let mut row: Vec<Cell> = Vec::new();
    let mut row_repeat = 1;
    let mut cell: Option<(Cell, usize)> = None;
    let mut paragraphs = 0;

    let push_cell = |row: &mut Vec<Cell>, c: Cell, n: usize| {
        let n = if c.text.is_empty() && n > MAX_REPEAT { 1 } else { n };
        for _ in 0..n {
            row.push(c.clone());
        }
    };

    loop {
        let ev = match r.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(ev) => ev,
        };
        match ev {
            Event::Start(e) | Event::Empty(e) if !in_first_table && e.name().as_ref() == "table:table" => {
                tables += 1;
                in_first_table = tables == 1;
            }
            Event::End(e) if e.name().as_ref() == "table:table" => in_first_table = false,
            _ if !in_first_table => {}
            Event::Start(e) if e.name().as_ref() == "table:table-row" => {
                row = Vec::new();
                row_repeat = repeat(&e, "table:number-rows-repeated");
            }
            Event::Empty(e) if e.name().as_ref() == "table:table-row" => {
                let n = repeat(&e, "table:number-rows-repeated").min(MAX_REPEAT);
                grid.extend((0..n).map(|_| Vec::new()));
            }
            Event::End(e) if e.name().as_ref() == "table:table-row" => {
                while row.last().is_some_and(|c| c.text.is_empty() && c.link.is_none()) {
                    row.pop();
                }
                let n = if row.is_empty() { row_repeat.min(MAX_REPEAT) } else { row_repeat };
                for _ in 0..n {
                    grid.push(row.clone());
                }
            }
            Event::Start(e) if matches!(e.name().as_ref(), "table:table-cell" | "table:covered-table-cell") => {
                cell = Some((Cell::default(), repeat(&e, "table:number-columns-repeated")));
                paragraphs = 0;
            }
            Event::Empty(e) if matches!(e.name().as_ref(), "table:table-cell" | "table:covered-table-cell") => {
                push_cell(&mut row, Cell::default(), repeat(&e, "table:number-columns-repeated"));
            }
            Event::End(e) if matches!(e.name().as_ref(), "table:table-cell" | "table:covered-table-cell") => {
                if let Some((mut c, n)) = cell.take() {
                    c.text = c.text.trim().to_string();
                    push_cell(&mut row, c, n);
                }
            }
            Event::Start(e) if e.name().as_ref() == "text:p" => {
                if let Some((c, _)) = cell.as_mut() {
                    if paragraphs > 0 {
                        c.text.push('\n');
                    }
                    paragraphs += 1;
                }
            }
            Event::Start(e) if e.name().as_ref() == "text:a" => {
                if let Some((c, _)) = cell.as_mut() {
                    c.link = c.link.take().or_else(|| attr(&e, "xlink:href"));
                }
            }
            Event::Empty(e) => {
                if let Some((c, _)) = cell.as_mut() {
                    match e.name().as_ref() {
                        "text:s" => c.text.push_str(&" ".repeat(repeat(&e, "text:c"))),
                        "text:line-break" => c.text.push('\n'),
                        "text:tab" => c.text.push('\t'),
                        _ => {}
                    }
                }
            }
            Event::Text(t) => {
                if let Some((c, _)) = cell.as_mut() {
                    c.text.push_str(&t);
                }
            }
            Event::GeneralRef(e) => {
                if let Some((c, _)) = cell.as_mut() {
                    c.text.push_str(match &*e {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    });
                }
            }
            _ => {}
        }
    }
    grid
}

/// `xl/sharedStrings.xml`: the text of every `<si>` in order.
fn shared_strings(xml: &str) -> Vec<String> {
    let mut r = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut cur: Option<String> = None;
    let mut in_t = false;
    loop {
        match r.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) if e.name().as_ref() == "si" => cur = Some(String::new()),
            Ok(Event::End(e)) if e.name().as_ref() == "si" => out.push(cur.take().unwrap_or_default()),
            Ok(Event::Start(e)) if e.name().as_ref() == "t" => in_t = true,
            Ok(Event::End(e)) if e.name().as_ref() == "t" => in_t = false,
            // Phonetic hints (<rPh>) also use <t>; they're rare and harmless here.
            Ok(Event::Text(t)) if in_t => {
                if let Some(s) = cur.as_mut() {
                    s.push_str(&t);
                }
            }
            Ok(Event::GeneralRef(e)) if in_t => {
                if let Some(s) = cur.as_mut() {
                    s.push_str(match &*e {
                        "amp" => "&",
                        "lt" => "<",
                        "gt" => ">",
                        "quot" => "\"",
                        "apos" => "'",
                        _ => "",
                    });
                }
            }
            _ => {}
        }
    }
    out
}

/// "AB12" -> (11, 27) zero-based (row, column).
fn cell_ref(r: &str) -> Option<(usize, usize)> {
    let letters: String = r.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    let row: usize = r[letters.len()..].parse().ok()?;
    let col = letters.bytes().fold(0usize, |acc, b| acc * 26 + (b.to_ascii_uppercase() - b'A' + 1) as usize);
    Some((row.checked_sub(1)?, col.checked_sub(1)?))
}

/// Excel (.xlsx). Hyperlinks aren't read (they live in a separate file).
pub fn read_xlsx(xml: &str, shared: &[String]) -> Grid {
    let mut r = Reader::from_str(xml);
    let mut grid: Grid = Vec::new();
    let mut pos: Option<(usize, usize)> = None;
    let mut kind = String::new();
    let mut value = String::new();
    let mut in_value = false;
    loop {
        match r.read_event() {
            Ok(Event::Eof) | Err(_) => break,
            Ok(Event::Start(e)) if e.name().as_ref() == "c" => {
                pos = attr(&e, "r").and_then(|r| cell_ref(&r));
                kind = attr(&e, "t").unwrap_or_default();
                value.clear();
            }
            Ok(Event::Start(e)) if matches!(e.name().as_ref(), "v" | "t") => in_value = true,
            Ok(Event::End(e)) if matches!(e.name().as_ref(), "v" | "t") => in_value = false,
            Ok(Event::Text(t)) if in_value => {
                value.push_str(&t);
            }
            Ok(Event::GeneralRef(e)) if in_value => value.push_str(match &*e {
                "amp" => "&",
                "lt" => "<",
                "gt" => ">",
                "quot" => "\"",
                "apos" => "'",
                _ => "",
            }),
            Ok(Event::End(e)) if e.name().as_ref() == "c" => {
                if let Some((row, col)) = pos.take() {
                    let text = match kind.as_str() {
                        "s" => value.trim().parse::<usize>().ok().and_then(|i| shared.get(i)).cloned().unwrap_or_default(),
                        _ => value.clone(),
                    };
                    if row >= grid.len() {
                        grid.resize(row + 1, Vec::new());
                    }
                    let line = &mut grid[row];
                    if col >= line.len() {
                        line.resize(col + 1, Cell::default());
                    }
                    line[col] = Cell { text: text.trim().to_string(), link: None };
                }
            }
            _ => {}
        }
    }
    grid
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ods_cells_links_spaces_and_repeats() {
        let xml = r#"<office:document-content><office:body><office:spreadsheet>
          <table:table table:name="A">
            <table:table-row><table:covered-table-cell/><table:table-cell><text:p><text:a xlink:href="https://youtu.be/x">Snatch-Grip RDL</text:a></text:p></table:table-cell>
              <table:table-cell table:number-columns-repeated="2"><text:p>135 -<text:s text:c="2"/>8 &amp; up</text:p></table:table-cell></table:table-row>
            <table:table-row table:number-rows-repeated="1000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>
            <table:table-row><table:table-cell><text:p>a</text:p><text:p>b</text:p></table:table-cell></table:table-row>
          </table:table>
          <table:table table:name="B"><table:table-row><table:table-cell><text:p>ignored</text:p></table:table-cell></table:table-row></table:table>
        </office:spreadsheet></office:body></office:document-content>"#;
        let g = read_ods(xml);
        assert_eq!(g[0][1].text, "Snatch-Grip RDL");
        assert_eq!(g[0][1].link.as_deref(), Some("https://youtu.be/x"));
        assert_eq!(g[0][2].text, "135 -  8 & up");
        assert_eq!(g[0][3].text, "135 -  8 & up");
        assert_eq!(g.len(), 1 + MAX_REPEAT + 1);
        assert_eq!(g.last().unwrap()[0].text, "a\nb");
    }

    #[test]
    fn xlsx_shared_and_inline_values() {
        let shared = shared_strings(r#"<sst><si><t>Week 1</t></si><si><r><t>Hack </t></r><r><t>Squat</t></r></si></sst>"#);
        let g = read_xlsx(
            r#"<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2" t="s"><v>1</v></c><c r="D2"><v>3</v></c></row></sheetData></worksheet>"#,
            &shared,
        );
        assert_eq!(g[1][0].text, "Week 1");
        assert_eq!(g[1][2].text, "Hack Squat");
        assert_eq!(g[1][3].text, "3");
    }

    #[test]
    fn cell_refs() {
        assert_eq!(cell_ref("A1"), Some((0, 0)));
        assert_eq!(cell_ref("AB12"), Some((11, 27)));
    }
}
