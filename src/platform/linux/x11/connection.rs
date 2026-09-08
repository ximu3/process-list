//! Bound protocol waits so a stalled X server cannot occupy a worker indefinitely.

use std::{
    io,
    os::fd::AsRawFd,
    time::{Duration, Instant},
};
use x11rb::rust_connection::{DefaultStream, PollMode, RustConnection, Stream};
use x11rb::utils::RawFdContainer;
use x11rb_protocol::{parse_display::parse_display, xauth::get_auth};

pub struct TimedStream {
    inner: DefaultStream,
    deadline: Instant,
}

pub fn connect()
-> Result<(RustConnection<TimedStream>, usize), Box<dyn std::error::Error + Send + Sync>> {
    let display = parse_display(None)?;
    let mut last_error = io::Error::new(io::ErrorKind::NotConnected, "No X11 transport available");
    for address in display.connect_instruction() {
        let (inner, (family, address)) = match DefaultStream::connect(&address) {
            Ok(connection) => connection,
            Err(error) => {
                last_error = error;
                continue;
            }
        };
        let (name, data) = match get_auth(family, &address, display.display) {
            Ok(auth) => auth.unwrap_or_default(),
            // Local servers may authorize via peer credentials without an authority file.
            Err(error) if error.kind() == io::ErrorKind::NotFound => Default::default(),
            Err(error) => return Err(error.into()),
        };
        let stream = TimedStream {
            inner,
            deadline: Instant::now() + Duration::from_secs(2),
        };
        let screen = usize::from(display.screen);
        return Ok((
            RustConnection::connect_to_stream_with_auth_info(stream, screen, name, data)?,
            screen,
        ));
    }
    Err(last_error.into())
}

impl TimedStream {
    fn remaining(&self) -> io::Result<Duration> {
        self.deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "X11 query timed out"))
    }
}

impl Stream for TimedStream {
    fn poll(&self, mode: PollMode) -> io::Result<()> {
        loop {
            let timeout = self.remaining()?.as_millis().clamp(1, i32::MAX as u128) as i32;
            let mut descriptor = libc::pollfd {
                fd: self.inner.as_raw_fd(),
                events: if mode.readable() { libc::POLLIN } else { 0 }
                    | if mode.writable() { libc::POLLOUT } else { 0 },
                revents: 0,
            };
            // SAFETY: descriptor is a valid writable pollfd and the stream owns its live FD.
            let count = unsafe { libc::poll(&mut descriptor, 1, timeout) };
            if count > 0 {
                return Ok(());
            }
            if count < 0 {
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }
    }

    fn read(&self, buffer: &mut [u8], descriptors: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.read(buffer, descriptors)
    }

    fn write(&self, buffer: &[u8], descriptors: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write(buffer, descriptors)
    }

    fn write_vectored(
        &self,
        buffers: &[io::IoSlice<'_>],
        descriptors: &mut Vec<RawFdContainer>,
    ) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write_vectored(buffers, descriptors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;

    #[test]
    fn stalled_socket_times_out() {
        let (socket, _peer) = UnixStream::pair().unwrap();
        let (inner, _) = DefaultStream::from_unix_stream(socket).unwrap();
        let stream = TimedStream {
            inner,
            deadline: Instant::now() + Duration::from_millis(20),
        };
        assert_eq!(
            stream.poll(PollMode::Readable).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
    }
}
