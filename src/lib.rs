//! Read-only process queries and foreground application identity.

#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(all(feature = "node", not(test)))]
mod binding;
mod model;
mod platform;

pub use model::{Foreground, Process};
use std::io;

/// Collect visible processes without querying the desktop session.
pub fn list_processes(pids: Option<&[u32]>) -> io::Result<Vec<Process>> {
    let mut processes = platform::list_processes(pids)?;
    processes.sort_unstable_by_key(|process| process.pid);
    processes.dedup_by_key(|process| process.pid);
    Ok(processes)
}

pub fn get_process(pid: u32) -> io::Result<Option<Process>> {
    platform::get_process(pid)
}

pub fn get_foreground() -> io::Result<Foreground> {
    platform::foreground()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn self_process_has_real_details() {
        let process = get_process(std::process::id()).unwrap().unwrap();
        assert_eq!(process.pid, std::process::id());
        assert!(process.name.as_ref().is_some_and(|name| !name.is_empty()));
        assert!(process.executable_path.is_some());
        assert!(process.memory_bytes.is_some_and(|bytes| bytes > 0));
        assert!(process.started_at.is_some_and(|time| time > 0.0));
        assert!(process.parent_pid.is_some());
    }

    #[test]
    fn lists_are_sorted_unique_and_filterable() {
        let pid = std::process::id();
        let processes = list_processes(Some(&[pid, pid])).unwrap();
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].pid, pid);
        assert!(list_processes(Some(&[])).unwrap().is_empty());
        let processes = list_processes(None).unwrap();
        assert!(processes.iter().any(|process| process.pid == pid));
        assert!(processes.windows(2).all(|pair| pair[0].pid < pair[1].pid));
    }
}
