use crate::Foreground;
use crate::platform::foreground_query::{Observation, retry};
use std::{fs, io};
use x11rb::connection::Connection;
use x11rb::errors::ReplyError;
use x11rb::protocol::ErrorKind;
use x11rb::protocol::xproto::{Atom, AtomEnum, ConnectionExt, GetPropertyReply};
mod connection;

pub fn foreground() -> io::Result<Foreground> {
    let (connection, screen) = connection::connect().map_err(io::Error::other)?;
    let root = connection.setup().roots[screen].root;
    // All attempts share the same connection and its two-second protocol deadline.
    retry(|| query(&connection, root).map_err(io::Error::other))
}

fn query(
    connection: &impl Connection,
    root: u32,
) -> Result<Observation, Box<dyn std::error::Error + Send + Sync>> {
    let active_atom = connection
        .intern_atom(true, b"_NET_ACTIVE_WINDOW")?
        .reply()?
        .atom;
    if active_atom == 0 {
        return Ok(Observation::Stable(Foreground::Unavailable {
            reason: "unsupported-desktop",
        }));
    }
    let active = connection
        .get_property(false, root, active_atom, AtomEnum::WINDOW, 0, 1)?
        .reply()?;
    let Some(window) = property_u32(&active, AtomEnum::WINDOW.into()) else {
        return Ok(Observation::Stable(Foreground::Unavailable {
            reason: "unsupported-desktop",
        }));
    };
    if window == 0 {
        return Ok(Observation::Stable(Foreground::None { source: "x11" }));
    }
    let hostname = fs::read_to_string("/proc/sys/kernel/hostname")?;
    let owner = match window_owner(connection, window, hostname.trim().as_bytes()) {
        Ok(value) => value,
        Err(ReplyError::X11Error(error)) if error.error_kind == ErrorKind::Window => {
            return Ok(Observation::Changed);
        }
        Err(error) => return Err(error.into()),
    };
    let end = connection
        .get_property(false, root, active_atom, AtomEnum::WINDOW, 0, 1)?
        .reply()?;
    Ok(
        if property_u32(&end, AtomEnum::WINDOW.into()) == Some(window) {
            Observation::Stable(owner)
        } else {
            Observation::Changed
        },
    )
}

fn window_owner(
    connection: &impl Connection,
    window: u32,
    hostname: &[u8],
) -> Result<Foreground, ReplyError> {
    let pid_atom = connection.intern_atom(true, b"_NET_WM_PID")?.reply()?.atom;
    if pid_atom == 0 {
        return Ok(Foreground::Unavailable {
            reason: "missing-pid",
        });
    }
    let pid = connection
        .get_property(false, window, pid_atom, AtomEnum::CARDINAL, 0, 1)?
        .reply()?;
    let Some(pid) = property_u32(&pid, AtomEnum::CARDINAL.into()).filter(|pid| *pid > 0) else {
        return Ok(Foreground::Unavailable {
            reason: "missing-pid",
        });
    };
    // EWMH PIDs belong to WM_CLIENT_MACHINE, which may be a different host.
    let machine = connection
        .get_property(
            false,
            window,
            AtomEnum::WM_CLIENT_MACHINE,
            AtomEnum::STRING,
            0,
            256,
        )?
        .reply()?;
    if machine.type_ != AtomEnum::STRING.into()
        || machine.format != 8
        || machine.bytes_after != 0
        || !same_host(&machine.value, hostname)
    {
        return Ok(Foreground::Unavailable {
            reason: "unverified-pid",
        });
    }
    Ok(Foreground::Active { pid, source: "x11" })
}

fn property_u32(reply: &GetPropertyReply, expected_type: Atom) -> Option<u32> {
    if reply.type_ != expected_type
        || reply.format != 32
        || reply.value_len != 1
        || reply.bytes_after != 0
    {
        return None;
    }
    reply.value32()?.next()
}

fn same_host(machine: &[u8], hostname: &[u8]) -> bool {
    let machine = machine.strip_suffix(&[0]).unwrap_or(machine);
    !machine.is_empty() && machine.eq_ignore_ascii_case(hostname)
}

#[cfg(test)]
mod tests {
    use super::*;
    use x11rb::rust_connection::RustConnection;

    #[test]
    fn does_not_attribute_a_remote_clients_pid_to_a_local_process() {
        assert!(same_host(b"workstation\0", b"workstation"));
        assert!(!same_host(b"remote", b"workstation"));
        assert!(!same_host(b"", b"workstation"));
    }

    #[test]
    fn validates_x11_property_type_format_and_length() {
        let mut reply = GetPropertyReply {
            format: 32,
            type_: AtomEnum::CARDINAL.into(),
            value_len: 1,
            value: 42u32.to_ne_bytes().to_vec(),
            ..Default::default()
        };
        assert_eq!(property_u32(&reply, AtomEnum::CARDINAL.into()), Some(42));
        assert_eq!(property_u32(&reply, AtomEnum::WINDOW.into()), None);
        reply.bytes_after = 4;
        assert_eq!(property_u32(&reply, AtomEnum::CARDINAL.into()), None);
        reply.bytes_after = 0;
        reply.format = 8;
        assert_eq!(property_u32(&reply, AtomEnum::CARDINAL.into()), None);
    }

    #[test]
    #[ignore = "requires PROCESS_LIST_X11_TEST=1 and an isolated Xvfb display"]
    fn x11_window_ownership_and_missing_capabilities() {
        use x11rb::protocol::xproto::{CreateWindowAux, PropMode, WindowClass};
        use x11rb::wrapper::ConnectionExt as _;

        assert_eq!(std::env::var("PROCESS_LIST_X11_TEST").as_deref(), Ok("1"));
        let (connection, screen) = RustConnection::connect(None).unwrap();
        let root = connection.setup().roots[screen].root;
        let window = connection.generate_id().unwrap();
        connection
            .create_window(
                x11rb::COPY_DEPTH_FROM_PARENT,
                window,
                root,
                0,
                0,
                10,
                10,
                0,
                WindowClass::INPUT_OUTPUT,
                0,
                &CreateWindowAux::new(),
            )
            .unwrap()
            .check()
            .unwrap();
        let active = connection
            .intern_atom(false, b"_NET_ACTIVE_WINDOW")
            .unwrap()
            .reply()
            .unwrap()
            .atom;
        let pid = connection
            .intern_atom(false, b"_NET_WM_PID")
            .unwrap()
            .reply()
            .unwrap()
            .atom;
        let hostname = fs::read_to_string("/proc/sys/kernel/hostname").unwrap();
        connection
            .change_property32(PropMode::REPLACE, root, active, AtomEnum::WINDOW, &[window])
            .unwrap()
            .check()
            .unwrap();
        connection
            .change_property32(
                PropMode::REPLACE,
                window,
                pid,
                AtomEnum::CARDINAL,
                &[std::process::id()],
            )
            .unwrap()
            .check()
            .unwrap();
        connection
            .change_property8(
                PropMode::REPLACE,
                window,
                AtomEnum::WM_CLIENT_MACHINE,
                AtomEnum::STRING,
                hostname.trim().as_bytes(),
            )
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            foreground().unwrap(),
            Foreground::Active {
                pid: std::process::id(),
                source: "x11"
            }
        );
        connection
            .change_property8(
                PropMode::REPLACE,
                window,
                AtomEnum::WM_CLIENT_MACHINE,
                AtomEnum::STRING,
                b"another-host",
            )
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            foreground().unwrap(),
            Foreground::Unavailable {
                reason: "unverified-pid"
            }
        );
        connection
            .delete_property(window, pid)
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            foreground().unwrap(),
            Foreground::Unavailable {
                reason: "missing-pid"
            }
        );
        connection
            .change_property32(PropMode::REPLACE, root, active, AtomEnum::WINDOW, &[0])
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(foreground().unwrap(), Foreground::None { source: "x11" });
        connection.destroy_window(window).unwrap().check().unwrap();
        connection
            .change_property32(PropMode::REPLACE, root, active, AtomEnum::WINDOW, &[window])
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            foreground().unwrap(),
            Foreground::Unavailable {
                reason: "changed-during-query"
            }
        );
        connection
            .delete_property(root, active)
            .unwrap()
            .check()
            .unwrap();
        assert_eq!(
            foreground().unwrap(),
            Foreground::Unavailable {
                reason: "unsupported-desktop"
            }
        );
    }
}
