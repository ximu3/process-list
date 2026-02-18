//! Cross-platform process list library
//!
//! A lightweight library for getting system process information.

#![deny(clippy::all)]

mod platform;
mod process;

use napi_derive::napi;
use process::ProcessInfo;

/// Options for controlling which optional fields to include
#[napi(object)]
#[derive(Default)]
pub struct GetProcessesOptions {
    /// Optional fields to include: "ppid", "memory", "startTime"
    pub include: Option<Vec<String>>,
}

/// Get all running processes
#[napi]
pub fn get_processes(options: Option<GetProcessesOptions>) -> Vec<ProcessInfo> {
    let opts = options.unwrap_or_default();
    let include_fields = opts.include.unwrap_or_default();

    let include_ppid = include_fields.iter().any(|f| f == "ppid");
    let include_memory = include_fields.iter().any(|f| f == "memory");
    let include_start_time = include_fields.iter().any(|f| f == "startTime");

    platform::get_processes(include_ppid, include_memory, include_start_time)
}

/// Get a single process by PID
#[napi]
pub fn get_process(pid: u32, options: Option<GetProcessesOptions>) -> Option<ProcessInfo> {
    let opts = options.unwrap_or_default();
    let include_fields = opts.include.unwrap_or_default();

    let include_ppid = include_fields.iter().any(|f| f == "ppid");
    let include_memory = include_fields.iter().any(|f| f == "memory");
    let include_start_time = include_fields.iter().any(|f| f == "startTime");

    platform::get_process(pid, include_ppid, include_memory, include_start_time)
}
