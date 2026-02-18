//! Linux-specific process enumeration
//!
//! NOTE:
//! This module is currently kept as a placeholder for future Linux support.
//! The only production-ready platform in this project is Windows.
//! Behavior here is best-effort and not part of the supported surface yet.

use crate::process::ProcessInfo;
use std::fs;
use std::path::Path;

/// Get the foreground window PID using X11
fn get_foreground_pid() -> Option<u32> {
  use std::ptr;
  use x11::xlib;

  unsafe {
    // Open display
    let display = xlib::XOpenDisplay(ptr::null());
    if display.is_null() {
      return None;
    }

    // Get root window of default screen
    let root = xlib::XDefaultRootWindow(display);

    // Atom for _NET_ACTIVE_WINDOW
    let atom_name = std::ffi::CString::new("_NET_ACTIVE_WINDOW").ok()?;
    let atom = xlib::XInternAtom(display, atom_name.as_ptr(), xlib::True);
    if atom == xlib::None {
      xlib::XCloseDisplay(display);
      return None;
    }

    // Get active window property
    let mut actual_type_return = 0;
    let mut actual_format_return = 0;
    let mut nitems_return = 0;
    let mut bytes_after_return = 0;
    let mut prop_return = ptr::null_mut();

    let status = xlib::XGetWindowProperty(
      display,
      root,
      atom,
      0,
      1,
      xlib::False,
      xlib::XA_WINDOW,
      &mut actual_type_return,
      &mut actual_format_return,
      &mut nitems_return,
      &mut bytes_after_return,
      &mut prop_return,
    );

    if status != xlib::Success as i32 || prop_return.is_null() || nitems_return == 0 {
      if !prop_return.is_null() {
        xlib::XFree(prop_return as *mut _);
      }
      xlib::XCloseDisplay(display);
      return None;
    }

    // Get window ID from property
    let window_id = *(prop_return as *const xlib::Window);
    xlib::XFree(prop_return as *mut _);

    // Get _NET_WM_PID of that window
    let atom_pid_name = std::ffi::CString::new("_NET_WM_PID").ok()?;
    let atom_pid = xlib::XInternAtom(display, atom_pid_name.as_ptr(), xlib::True);

    if atom_pid == xlib::None {
      xlib::XCloseDisplay(display);
      return None;
    }

    let status_pid = xlib::XGetWindowProperty(
      display,
      window_id,
      atom_pid,
      0,
      1,
      xlib::False,
      xlib::XA_CARDINAL,
      &mut actual_type_return,
      &mut actual_format_return,
      &mut nitems_return,
      &mut bytes_after_return,
      &mut prop_return,
    );

    let mut result = None;
    if status_pid == xlib::Success as i32 && !prop_return.is_null() && nitems_return > 0 {
      let pid = *(prop_return as *const u32);
      result = Some(pid);
    }

    if !prop_return.is_null() {
      xlib::XFree(prop_return as *mut _);
    }
    xlib::XCloseDisplay(display);

    result
  }
}

/// Read process name from /proc/{pid}/comm
fn get_name(pid: u32) -> Option<String> {
  let path = format!("/proc/{}/comm", pid);
  fs::read_to_string(&path).ok().map(|s| s.trim().to_string())
}

/// Read process executable path from /proc/{pid}/exe
fn get_path(pid: u32) -> Option<String> {
  let path = format!("/proc/{}/exe", pid);
  fs::read_link(&path)
    .ok()
    .map(|p| p.to_string_lossy().into_owned())
}

/// Read parent PID from /proc/{pid}/stat
fn get_ppid(pid: u32) -> Option<u32> {
  let path = format!("/proc/{}/stat", pid);
  let content = fs::read_to_string(&path).ok()?;

  // Format: pid (comm) state ppid ...
  // Find the closing paren to handle comm with spaces
  let close_paren = content.rfind(')')?;
  let after_comm = &content[close_paren + 2..];
  let fields: Vec<&str> = after_comm.split_whitespace().collect();

  // ppid is the second field after comm (index 1)
  fields.get(1)?.parse().ok()
}

/// Read memory usage from /proc/{pid}/statm
fn get_memory(pid: u32) -> Option<u64> {
  let path = format!("/proc/{}/statm", pid);
  let content = fs::read_to_string(&path).ok()?;
  let fields: Vec<&str> = content.split_whitespace().collect();

  // Second field is RSS in pages
  let rss_pages: u64 = fields.get(1)?.parse().ok()?;
  // Page size is typically 4096 bytes
  let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) as u64 };
  Some(rss_pages * page_size)
}

/// Read start time from /proc/{pid}/stat
fn get_start_time(pid: u32) -> Option<f64> {
  let path = format!("/proc/{}/stat", pid);
  let content = fs::read_to_string(&path).ok()?;

  let close_paren = content.rfind(')')?;
  let after_comm = &content[close_paren + 2..];
  let fields: Vec<&str> = after_comm.split_whitespace().collect();

  // starttime is field 20 (0-indexed: 19) after comm
  let start_ticks: u64 = fields.get(19)?.parse().ok()?;

  // Convert from clock ticks to milliseconds
  let ticks_per_sec = unsafe { libc::sysconf(libc::_SC_CLK_TCK) as u64 };
  if ticks_per_sec == 0 {
    return None;
  }

  // Get system boot time
  let uptime_content = fs::read_to_string("/proc/uptime").ok()?;
  let uptime_secs: f64 = uptime_content.split_whitespace().next()?.parse().ok()?;

  // Calculate start time as Unix timestamp
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .ok()?;
  let boot_time = now.as_secs_f64() - uptime_secs;
  let process_start = boot_time + (start_ticks as f64 / ticks_per_sec as f64);

  Some(process_start * 1000.0) // Convert to milliseconds
}

/// Get all running processes
pub fn get_processes(
  include_ppid: bool,
  include_memory: bool,
  include_start_time: bool,
) -> Vec<ProcessInfo> {
  // Placeholder implementation for Linux.
  // Keep API shape consistent with Windows while Linux support is incomplete.
  let mut processes = Vec::new();
  let foreground_pid = get_foreground_pid();

  // Read /proc directory
  let proc_dir = match fs::read_dir("/proc") {
    Ok(dir) => dir,
    Err(_) => return processes,
  };

  for entry in proc_dir.flatten() {
    let file_name = entry.file_name();
    let name_str = file_name.to_string_lossy();

    // Only process numeric directories (PIDs)
    if let Ok(pid) = name_str.parse::<u32>() {
      if let Some(name) = get_name(pid) {
        let mut info = ProcessInfo::new(pid, name);
        info.path = get_path(pid);
        info.is_foreground = foreground_pid == Some(pid);

        if include_ppid {
          info.ppid = get_ppid(pid);
        }
        if include_memory {
          info.memory = get_memory(pid).map(|m| m as f64);
        }
        if include_start_time {
          info.start_time = get_start_time(pid);
        }

        processes.push(info);
      }
    }
  }

  processes
}

/// Get a single process by PID
pub fn get_process(
  pid: u32,
  include_ppid: bool,
  include_memory: bool,
  include_start_time: bool,
) -> Option<ProcessInfo> {
  // Placeholder implementation for Linux.
  // Returned values are best-effort and currently not guaranteed.
  let proc_path = format!("/proc/{}", pid);
  if !Path::new(&proc_path).exists() {
    return None;
  }

  let foreground_pid = get_foreground_pid();
  let name = get_name(pid)?;

  let mut info = ProcessInfo::new(pid, name);
  info.path = get_path(pid);
  info.is_foreground = foreground_pid == Some(pid);

  if include_ppid {
    info.ppid = get_ppid(pid);
  }
  if include_memory {
    info.memory = get_memory(pid).map(|m| m as f64);
  }
  if include_start_time {
    info.start_time = get_start_time(pid);
  }

  Some(info)
}
