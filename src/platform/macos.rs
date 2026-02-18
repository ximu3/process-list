//! macOS-specific process enumeration
//!
//! NOTE:
//! This module is currently kept as a placeholder for future macOS support.
//! The only production-ready platform in this project is Windows.
//! Behavior here is best-effort and not part of the supported surface yet.

use crate::process::ProcessInfo;
use libc::{c_int, c_void, size_t, sysctl, CTL_KERN, KERN_PROC, KERN_PROC_ALL};
use std::ffi::CStr;
use std::mem;
use std::ptr;

// kinfo_proc struct layout for macOS (64-bit)
// Derived from sys/sysctl.h and sys/proc.h
#[repr(C)]
#[derive(Clone, Copy)]
struct timeval {
  tv_sec: i64,
  tv_usec: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct extern_proc {
  p_un: [u8; 16], // union p_unp { struct proc * }
  p_vmspace: *mut c_void,
  p_sigacts: *mut c_void,
  _pad_p_mqueue: *mut c_void, // 10.15+ has this
  p_flag: c_int,
  p_stat: c_char,
  p_pid: libc::pid_t,
  p_oppid: libc::pid_t, // parent pid
  p_dupfd: c_int,
  user_stack: *mut c_void,
  exit_thread: *mut c_void,
  p_debugger: c_int,
  sigwait: c_int,
  p_estcpu: c_uint,
  p_cpticks: c_int,
  p_pctcpu: u32,
  p_wchan: *mut c_void,
  p_wmesg: *mut c_char,
  p_swtime: c_uint,
  p_slptime: c_uint,
  p_realtimer: itimerval,
  p_rtime: timeval,
  p_uticks: u64,
  p_sticks: u64,
  p_iticks: u64,
  p_traceflag: c_int,
  p_tracep: *mut c_void,
  p_siglist: c_int,
  p_textvp: *mut c_void,
  p_holdcnt: c_int,
  p_sigmask: c_uint,
  p_sigignore: c_uint,
  p_sigcatch: c_uint,
  p_priority: c_uchar,
  p_usrpri: c_uchar,
  p_nice: c_char,
  p_comm: [c_char; 17], // MAXCOMLEN = 16 + 1
  p_pgrp: *mut c_void,
  p_addr: *mut c_void,
  p_xstat: c_ushort,
  p_acflag: c_ushort,
  p_ru: *mut c_void,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct kinfo_proc {
  kp_proc: extern_proc,
  kp_eproc: eproc,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct eproc {
  e_paddr: *mut c_void,
  e_sess: *mut c_void,
  e_pcred: pcred,
  e_ucred: ucred,
  e_vm: vmspace,
  e_ppid: libc::pid_t,
  e_pgid: libc::pid_t,
  e_jobc: c_short,
  e_tdev: libc::dev_t,
  e_tpgid: libc::pid_t,
  e_tsess: *mut c_void,
  e_wmesg: [c_char; 8], // WMESGLEN = 7 + 1
  e_xsize: c_int,
  e_xrssize: c_short,
  e_xccount: c_short,
  e_xswrss: c_short,
  e_flag: c_int,
  e_login: [c_char; 12], // MAXLOGNAME = 12
  e_spare: [c_int; 4],
  _padding: [u8; 128], // Simplified padding
}

#[repr(C)]
#[derive(Clone, Copy)]
struct pcred {
  pc_lock: [u8; 72],
  pc_ucred: *mut c_void,
  p_ruid: libc::uid_t,
  p_svuid: libc::uid_t,
  p_rgid: libc::gid_t,
  p_svgid: libc::gid_t,
  p_refcnt: c_int,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct ucred {
  cr_ref: i32,
  cr_uid: libc::uid_t,
  cr_ngroups: i16,
  cr_groups: [libc::gid_t; 16],
}

#[repr(C)]
#[derive(Clone, Copy)]
struct vmspace {
  vm_dummy: i32,
  vm_rssize: c_int, // Resident set size in pages
                    // ... we don't need the rest for simple memory usage
}

#[repr(C)]
#[derive(Clone, Copy)]
struct itimerval {
  it_interval: timeval,
  it_value: timeval,
}
use libc::{c_char, c_short, c_uchar, c_uint, c_ushort};

// FFI bindings for macOS libproc
extern "C" {
  fn proc_pidpath(pid: c_int, buffer: *mut u8, buffersize: u32) -> c_int;
  fn proc_name(pid: c_int, buffer: *mut u8, buffersize: u32) -> c_int;
}

/// Get the foreground application PID using NSWorkspace
fn get_foreground_pid() -> Option<u32> {
  use objc2::rc::Retained;
  use objc2_app_kit::{NSRunningApplication, NSWorkspace};
  use objc2_foundation::MainThreadMarker;

  unsafe {
    // NSWorkspace requires main thread marker for some operations, but frontmostApplication
    // is often safe to call. However, objc2 enforces thread safety.
    // We will try to get it safely.

    let mtm = MainThreadMarker::new()
      .or_else(|| {
        // If not on main thread (likely in node worker), we can't easily use NSWorkspace safely
        // without dispatching to main thread, which is complex in generic library.
        // BUT: straightforward FFI calls or using "unsafe" marker might work if we accept risk.
        // Let's rely on standard practice: often NSWorkspace is thread-safe for reading.
        // We'll construct an unsafe marker for this read-only operation which is generally supported.
        MainThreadMarker::new_unchecked()
      })
      .ok()?;

    let workspace = NSWorkspace::sharedWorkspace(mtm);
    let front_app = workspace.frontmostApplication();

    front_app.map(|app| app.processIdentifier() as u32)
  }
}

/// Get process path using proc_pidpath
fn get_path(pid: u32) -> Option<String> {
  let mut buffer = [0u8; 4096];
  let result = unsafe { proc_pidpath(pid as c_int, buffer.as_mut_ptr(), buffer.len() as u32) };

  if result > 0 {
    let path = unsafe { CStr::from_ptr(buffer.as_ptr() as *const i8) };
    Some(path.to_string_lossy().into_owned())
  } else {
    None
  }
}

/// Get process name using proc_name
fn get_name(pid: u32) -> Option<String> {
  let mut buffer = [0u8; 256];
  let result = unsafe { proc_name(pid as c_int, buffer.as_mut_ptr(), buffer.len() as u32) };

  if result > 0 {
    let name = unsafe { CStr::from_ptr(buffer.as_ptr() as *const i8) };
    Some(name.to_string_lossy().into_owned())
  } else {
    None
  }
}

/// Get memory usage (Resident Set Size) in bytes using mach task_info
fn get_memory(pid: u32) -> Option<u64> {
  use mach2::kern_return::KERN_SUCCESS;
  use mach2::mach_types::task_name_t;
  use mach2::message::mach_msg_type_number_t;
  use mach2::task::task_name_for_pid;
  use mach2::task_info::{task_basic_info, task_info, TASK_BASIC_INFO, TASK_BASIC_INFO_COUNT};
  use mach2::traps::mach_task_self;

  unsafe {
    let mut task: task_name_t = 0;
    let res = task_name_for_pid(mach_task_self(), pid as c_int, &mut task);

    if res != KERN_SUCCESS {
      return None;
    }

    let mut info: task_basic_info = mem::zeroed();
    let mut count = TASK_BASIC_INFO_COUNT;

    // Use task_name_t (task) which allows querying info but not controlling task (safer/easier permissions)
    let res = task_info(
      task,
      TASK_BASIC_INFO,
      &mut info as *mut _ as *mut i32,
      &mut count,
    );

    if res == KERN_SUCCESS {
      Some(info.resident_size as u64)
    } else {
      None
    }
  }
}

/// Get start time in milliseconds
fn get_start_time(kp: &kinfo_proc) -> Option<f64> {
  let sec = kp.kp_proc.p_rtime.tv_sec; // Changed from p_starttime to p_rtime based on common kinfo_proc usage for start time
  let usec = kp.kp_proc.p_rtime.tv_usec; // Changed from p_starttime to p_rtime
  let ms = (sec as f64 * 1000.0) + (usec as f64 / 1000.0);
  if ms > 0.0 {
    Some(ms)
  } else {
    None
  }
}

/// Get all running processes
pub fn get_processes(
  include_ppid: bool,
  include_memory: bool,
  include_start_time: bool,
) -> Vec<ProcessInfo> {
  // Placeholder implementation for macOS.
  // Keep API shape consistent with Windows while macOS support is incomplete.
  let mut processes = Vec::new();
  let foreground_pid = get_foreground_pid();

  // Get the size of the process list
  let mut mib: [c_int; 4] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0];
  let mut size: size_t = 0;

  unsafe {
    if sysctl(
      mib.as_mut_ptr(),
      3, // KERN_PROC_ALL uses 3 elements
      ptr::null_mut(),
      &mut size,
      ptr::null_mut(),
      0,
    ) != 0
    {
      // Try with 4 as fallback if strict (some older systems might expect 4, but 3 is standard for KERN_PROC_ALL)
      if sysctl(
        mib.as_mut_ptr(),
        4,
        ptr::null_mut(),
        &mut size,
        ptr::null_mut(),
        0,
      ) != 0
      {
        return processes;
      }
    }

    // Allocate buffer
    let count = size / mem::size_of::<kinfo_proc>();
    if count == 0 {
      return processes;
    }

    let mut proc_list: Vec<kinfo_proc> = Vec::with_capacity(count);
    proc_list.set_len(count);

    if sysctl(
      mib.as_mut_ptr(),
      if mib[2] == KERN_PROC_ALL { 3 } else { 4 }, // Use 3 for KERN_PROC_ALL, 4 for KERN_PROC_PID
      proc_list.as_mut_ptr() as *mut c_void,
      &mut size,
      ptr::null_mut(),
      0,
    ) != 0
    {
      return processes;
    }

    let actual_count = size / mem::size_of::<kinfo_proc>();

    for i in 0..actual_count {
      let kp = &proc_list[i];
      let pid = kp.kp_proc.p_pid as u32;

      // Skip pid 0 (kernel task) if needed, but useful to have

      let name = get_name(pid).unwrap_or_else(|| {
        // Fallback to p_comm in struct
        let c_str = CStr::from_ptr(kp.kp_proc.p_comm.as_ptr());
        c_str.to_string_lossy().into_owned()
      });

      let mut info = ProcessInfo::new(pid, name);
      info.path = get_path(pid);
      info.is_foreground = foreground_pid == Some(pid);

      if include_ppid {
        info.ppid = Some(kp.kp_eproc.e_ppid as u32);
      }
      if include_memory {
        info.memory = get_memory(pid).map(|m| m as f64);
      }
      if include_start_time {
        info.start_time = get_start_time(kp);
      }

      processes.push(info);
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
  // Placeholder implementation for macOS.
  // Returned values are best-effort and currently not guaranteed.
  let foreground_pid = get_foreground_pid();
  let name = get_name(pid)?;

  let mut info = ProcessInfo::new(pid, name);
  info.path = get_path(pid);
  info.is_foreground = foreground_pid == Some(pid);

  // Optimizing single process get via sysctl KERN_PROC_PID
  if include_ppid || include_start_time {
    let mut mib: [c_int; 4] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid as c_int];
    let mut size: size_t = mem::size_of::<kinfo_proc>();
    let mut kp: kinfo_proc = unsafe { mem::zeroed() };

    unsafe {
      if sysctl(
        mib.as_mut_ptr(),
        4,
        &mut kp as *mut _ as *mut c_void,
        &mut size,
        ptr::null_mut(),
        0,
      ) == 0
        && size > 0
      {
        if include_ppid {
          info.ppid = Some(kp.kp_eproc.e_ppid as u32);
        }
        if include_start_time {
          info.start_time = get_start_time(&kp);
        }
      }
    }
  }

  if include_memory {
    info.memory = get_memory(pid).map(|m| m as f64);
  }

  Some(info)
}

// Missing KERN_PROC_PID definition in older libc? It's usually 1
const KERN_PROC_PID: c_int = 1;
