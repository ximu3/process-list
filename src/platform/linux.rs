use super::procfs;
use crate::{Foreground, Process};
use std::{fs, io, path::Path};

mod x11;

struct Clock {
    boot_seconds: Option<u64>,
    ticks_per_second: Option<u64>,
    page_size: Option<u64>,
}

impl Clock {
    fn read(root: &Path) -> Self {
        // SAFETY: sysconf reads process-independent system configuration and has no pointer arguments.
        let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
        // SAFETY: The page-size query has no side effects or pointer arguments.
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        Self {
            boot_seconds: fs::read_to_string(root.join("stat"))
                .ok()
                .and_then(|value| procfs::boot_seconds(&value)),
            ticks_per_second: u64::try_from(ticks).ok().filter(|value| *value > 0),
            page_size: u64::try_from(page_size).ok().filter(|value| *value > 0),
        }
    }
}

pub fn list_processes(pids: Option<&[u32]>) -> io::Result<Vec<Process>> {
    let root = Path::new("/proc");
    let clock = Clock::read(root);
    if let Some(pids) = pids {
        return pids
            .iter()
            .filter_map(|pid| read_process(root, *pid, &clock).transpose())
            .collect();
    }
    let mut processes = Vec::new();
    // Failure to enumerate procfs is a failed query, not an empty process list.
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        if let Some(process) = read_process(root, pid, &clock)? {
            processes.push(process);
        }
    }
    Ok(processes)
}

pub fn get_process(pid: u32) -> io::Result<Option<Process>> {
    let root = Path::new("/proc");
    // Distinguish an absent procfs mount from an absent PID.
    fs::metadata(root)?;
    read_process(root, pid, &Clock::read(root))
}

fn read_process(root: &Path, pid: u32, clock: &Clock) -> io::Result<Option<Process>> {
    let directory = root.join(pid.to_string());
    let mut process = Process::new(pid);
    let stat = match fs::read(directory.join("stat")) {
        Ok(bytes) => procfs::parse_stat(&bytes)
            .filter(|stat| stat.pid == pid)
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("Invalid procfs stat for PID {pid}"),
                )
            })?,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => return Ok(Some(process)),
        Err(error) => return Err(error),
    };
    process.name = Some(stat.name);
    process.parent_pid = Some(stat.parent_pid);
    process.memory_bytes = stat
        .resident_pages
        .zip(clock.page_size)
        .and_then(|(pages, size)| pages.checked_mul(size));
    process.started_at = clock
        .boot_seconds
        .zip(clock.ticks_per_second)
        .and_then(|(boot, ticks)| procfs::start_ms(boot, stat.start_ticks, ticks));
    process.executable_path = fs::read_link(directory.join("exe"))
        .ok()
        .map(|value| value.to_string_lossy().into_owned());
    // Do not combine a recycled PID's executable path with the earlier process's metadata.
    match fs::read(directory.join("stat")) {
        Ok(bytes)
            if procfs::parse_stat(&bytes)
                .is_some_and(|end| end.pid == pid && end.start_ticks == stat.start_ticks) =>
        {
            Ok(Some(process))
        }
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            process.executable_path = None;
            Ok(Some(process))
        }
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(None),
    }
}

pub fn foreground() -> io::Result<Foreground> {
    match session(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some_and(|value| !value.is_empty()),
        std::env::var("DISPLAY").ok().as_deref(),
    ) {
        Some(reason) => Ok(Foreground::Unavailable { reason }),
        None => x11::foreground(),
    }
}

fn session(
    kind: Option<&str>,
    wayland_display: bool,
    display: Option<&str>,
) -> Option<&'static str> {
    if kind.is_some_and(|kind| kind.eq_ignore_ascii_case("wayland")) || wayland_display {
        Some("wayland")
    } else if display.is_none_or(str::is_empty) {
        Some("no-display")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_mistakes_xwayland_for_the_full_desktop() {
        assert_eq!(session(Some("wayland"), false, Some(":0")), Some("wayland"));
        assert_eq!(session(None, true, Some(":0")), Some("wayland"));
        assert_eq!(session(None, false, None), Some("no-display"));
        assert_eq!(session(Some("x11"), false, Some(":0")), None);
    }
}
