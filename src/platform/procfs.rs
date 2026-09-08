//! Pure parsers kept separate from filesystem access so edge cases run on every host.

#[derive(Debug, PartialEq)]
pub struct Stat {
    pub pid: u32,
    pub name: String,
    pub parent_pid: u32,
    pub start_ticks: u64,
    pub resident_pages: Option<u64>,
}

pub fn parse_stat(bytes: &[u8]) -> Option<Stat> {
    let open = bytes.iter().position(|byte| *byte == b'(')?;
    let close = bytes.iter().rposition(|byte| *byte == b')')?;
    if open == 0 || close <= open || bytes.get(close + 1) != Some(&b' ') {
        return None;
    }
    let pid = std::str::from_utf8(&bytes[..open])
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let tail = std::str::from_utf8(&bytes[close + 2..]).ok()?;
    let fields: Vec<_> = tail.split_ascii_whitespace().collect();
    if fields.first()?.len() != 1 {
        return None;
    }
    Some(Stat {
        pid,
        name: String::from_utf8_lossy(&bytes[open + 1..close]).into_owned(),
        parent_pid: fields.get(1)?.parse().ok()?,
        start_ticks: fields.get(19)?.parse().ok()?,
        resident_pages: fields.get(21)?.parse().ok(),
    })
}

pub fn boot_seconds(contents: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        let mut words = line.split_ascii_whitespace();
        (words.next()? == "btime")
            .then(|| words.next()?.parse().ok())
            .flatten()
    })
}

pub fn start_ms(boot: u64, ticks: u64, ticks_per_second: u64) -> Option<f64> {
    (ticks_per_second > 0)
        .then(|| boot as f64 * 1000.0 + ticks as f64 * 1000.0 / ticks_per_second as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(name: &[u8], rss: &str) -> Vec<u8> {
        let mut value = b"42 (".to_vec();
        value.extend(name);
        value.extend(
            format!(") S 7 7 7 0 -1 4194304 100 0 0 0 5 2 0 0 20 0 1 0 1234 409600 {rss}\n")
                .as_bytes(),
        );
        value
    }

    #[test]
    fn parses_parentheses_newlines_and_non_utf8_names() {
        let stat = parse_stat(&record(b"a ) ( b\n\xff", "12")).unwrap();
        assert_eq!(stat.pid, 42);
        assert_eq!(stat.name, "a ) ( b\n\u{fffd}");
        assert_eq!(stat.parent_pid, 7);
        assert_eq!(stat.start_ticks, 1234);
        assert_eq!(stat.resident_pages, Some(12));
    }

    #[test]
    fn rejects_truncated_or_malformed_records_without_panicking() {
        for value in [b"".as_slice(), b"42 ()", b")(", b"42 (name) S 1"] {
            assert_eq!(parse_stat(value), None);
        }
        assert_eq!(
            parse_stat(&record(b"name", "-1")).unwrap().resident_pages,
            None
        );
    }

    #[test]
    fn start_time_uses_boot_time_and_real_tick_frequency() {
        assert_eq!(
            boot_seconds("cpu 1 2\nbtime 1700000000\nprocesses 42\n"),
            Some(1700000000)
        );
        assert_eq!(boot_seconds("btimeX 123"), None);
        assert_eq!(start_ms(1700000000, 1234, 100), Some(1700000012340.0));
        assert_eq!(start_ms(1, 1, 0), None);
    }
}
