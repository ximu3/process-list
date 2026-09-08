use crate::{Foreground, Process};
use libc::{
    PROC_PIDPATHINFO_MAXSIZE, PROC_PIDTASKINFO, PROC_PIDTBSDINFO, proc_bsdinfo, proc_taskinfo,
};
use objc2::rc::autoreleasepool;
use objc2_app_kit::NSWorkspace;
use std::{
    io,
    mem::{MaybeUninit, size_of},
    ptr,
};

// PROC_ALL_PIDS from Apple's sys/proc_info.h (not currently exported by libc).
const PROC_ALL_PIDS: u32 = 1;

fn enumerate_pids() -> io::Result<Vec<u32>> {
    // SAFETY: A null buffer asks libproc for the number of bytes required.
    let required = unsafe { libc::proc_listpids(PROC_ALL_PIDS, 0, ptr::null_mut(), 0) };
    if required <= 0 {
        return Err(io::Error::last_os_error());
    }
    let mut capacity = required as usize / size_of::<i32>() + 256;
    // The process table can grow between sizing and reading. A full buffer is retried.
    for _ in 0..8 {
        let mut pids = vec![0i32; capacity];
        let size = i32::try_from(pids.len() * size_of::<i32>()).map_err(io::Error::other)?;
        // SAFETY: pids is correctly aligned, initialized, and has size writable bytes.
        let bytes =
            unsafe { libc::proc_listpids(PROC_ALL_PIDS, 0, pids.as_mut_ptr().cast(), size) };
        if bytes < 0 {
            return Err(io::Error::last_os_error());
        }
        if !(bytes as usize).is_multiple_of(size_of::<i32>()) || bytes > size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid libproc PID buffer length",
            ));
        }
        if bytes < size {
            pids.truncate(bytes as usize / size_of::<i32>());
            // PID zero is the kernel task; unused zero slots occur only after the returned bytes.
            return Ok(pids
                .into_iter()
                .filter_map(|pid| u32::try_from(pid).ok())
                .collect());
        }
        capacity = capacity
            .checked_mul(2)
            .ok_or_else(|| io::Error::other("Process table is too large"))?;
    }
    Err(io::Error::other(
        "Process table kept growing during enumeration",
    ))
}

pub fn list_processes(pids: Option<&[u32]>) -> io::Result<Vec<Process>> {
    if pids.is_some_and(<[u32]>::is_empty) {
        return Ok(Vec::new());
    }
    let mut result = Vec::new();
    for pid in enumerate_pids()? {
        if pids.is_none_or(|pids| pids.contains(&pid))
            && let Some(process) = read_process(pid)?
        {
            result.push(process);
        }
    }
    Ok(result)
}

pub fn get_process(pid: u32) -> io::Result<Option<Process>> {
    read_process(pid)
}

fn bsd_info(pid: i32) -> io::Result<proc_bsdinfo> {
    let mut info = MaybeUninit::<proc_bsdinfo>::zeroed();
    // SAFETY: The flavor matches proc_bsdinfo; storage is aligned and exactly the passed size.
    let count = unsafe {
        libc::proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size_of::<proc_bsdinfo>() as i32,
        )
    };
    if count != size_of::<proc_bsdinfo>() as i32 {
        return Err(if count <= 0 {
            io::Error::last_os_error()
        } else {
            io::Error::new(io::ErrorKind::InvalidData, "Truncated libproc BSD info")
        });
    }
    // SAFETY: libproc initialized a complete proc_bsdinfo above; all fields are integer types.
    Ok(unsafe { info.assume_init() })
}

fn read_process(pid: u32) -> io::Result<Option<Process>> {
    let Ok(native_pid) = i32::try_from(pid) else {
        return Ok(None);
    };
    let mut process = Process::new(pid);
    let info = match bsd_info(native_pid) {
        Ok(info) => info,
        Err(error) if matches!(error.raw_os_error(), Some(libc::ESRCH | libc::ENOENT)) => {
            return Ok(None);
        }
        Err(error) if matches!(error.raw_os_error(), Some(libc::EPERM | libc::EACCES)) => {
            return Ok(Some(process));
        }
        Err(error) => return Err(error),
    };
    process.name = c_name(&info.pbi_name).or_else(|| c_name(&info.pbi_comm));
    process.parent_pid = Some(info.pbi_ppid);
    process.started_at =
        Some(info.pbi_start_tvsec as f64 * 1000.0 + info.pbi_start_tvusec as f64 / 1000.0);
    let mut path = vec![0u8; PROC_PIDPATHINFO_MAXSIZE as usize];
    // SAFETY: path has the documented maximum capacity and stays live for the call.
    let length =
        unsafe { libc::proc_pidpath(native_pid, path.as_mut_ptr().cast(), path.len() as u32) };
    if length > 0 && (length as usize) <= path.len() {
        let end = path
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(length as usize);
        process.executable_path = Some(String::from_utf8_lossy(&path[..end]).into_owned());
    }
    let mut task = MaybeUninit::<proc_taskinfo>::zeroed();
    // SAFETY: The selected flavor writes proc_taskinfo to an aligned buffer of the specified size.
    if unsafe {
        libc::proc_pidinfo(
            native_pid,
            PROC_PIDTASKINFO,
            0,
            task.as_mut_ptr().cast(),
            size_of::<proc_taskinfo>() as i32,
        )
    } == size_of::<proc_taskinfo>() as i32
    {
        // SAFETY: The complete output was initialized by the successful libproc call.
        process.memory_bytes = Some(unsafe { task.assume_init() }.pti_resident_size);
    }
    match bsd_info(native_pid) {
        Ok(end)
            if end.pbi_start_tvsec == info.pbi_start_tvsec
                && end.pbi_start_tvusec == info.pbi_start_tvusec
                && end.pbi_pid == pid =>
        {
            Ok(Some(process))
        }
        Err(error) if matches!(error.raw_os_error(), Some(libc::EPERM | libc::EACCES)) => {
            process.executable_path = None;
            process.memory_bytes = None;
            Ok(Some(process))
        }
        Err(error) if !matches!(error.raw_os_error(), Some(libc::ESRCH | libc::ENOENT)) => {
            Err(error)
        }
        _ => Ok(None),
    }
}

fn c_name(bytes: &[libc::c_char]) -> Option<String> {
    let bytes: Vec<u8> = bytes
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect();
    (!bytes.is_empty()).then(|| String::from_utf8_lossy(&bytes).into_owned())
}

pub fn foreground() -> io::Result<Foreground> {
    Ok(autoreleasepool(|_| {
        // A fresh workspace avoids retaining cached application state in a Node.js process
        // without an AppKit event loop. All Objective-C objects stay on this calling thread.
        let workspace = NSWorkspace::new();
        match workspace.frontmostApplication() {
            Some(application) => match u32::try_from(application.processIdentifier()) {
                Ok(pid) if pid > 0 => Foreground::Active {
                    pid,
                    source: "appkit",
                },
                _ => Foreground::Unavailable {
                    reason: "missing-pid",
                },
            },
            None => Foreground::None { source: "appkit" },
        }
    }))
}
