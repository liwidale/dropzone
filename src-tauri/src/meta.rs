use std::path::Path;

pub struct Extra {
    pub added: Option<i64>,
    pub from: Option<String>,
    pub screen_capture: bool,
}

#[cfg(target_os = "macos")]
pub fn read(path: &Path, wants_capture_flag: bool) -> Extra {
    const WHERE_FROMS: &str = "com.apple.metadata:kMDItemWhereFroms";
    const SCREEN_CAPTURE: &str = "com.apple.metadata:kMDItemIsScreenCapture";
    let names: Vec<String> = xattr::list(path)
        .map(|l| l.filter_map(|n| n.into_string().ok()).collect())
        .unwrap_or_default();
    let from = names
        .iter()
        .any(|n| n == WHERE_FROMS)
        .then(|| xattr::get(path, WHERE_FROMS).ok().flatten())
        .flatten()
        .and_then(|raw| plist::from_bytes::<Vec<String>>(&raw).ok())
        .and_then(|list| list.iter().find_map(|u| host(u)));
    let screen_capture = wants_capture_flag && names.iter().any(|n| n == SCREEN_CAPTURE);
    Extra {
        added: added_time(path),
        from,
        screen_capture,
    }
}

#[cfg(target_os = "linux")]
pub fn read(path: &Path, _: bool) -> Extra {
    let from = xattr::get(path, "user.xdg.origin.url")
        .ok()
        .flatten()
        .and_then(|raw| String::from_utf8(raw).ok())
        .and_then(|u| host(&u));
    Extra {
        added: None,
        from,
        screen_capture: false,
    }
}

#[cfg(windows)]
pub fn read(path: &Path, _: bool) -> Extra {
    let mut stream = path.as_os_str().to_os_string();
    stream.push(":Zone.Identifier");
    let from = std::fs::read_to_string(&stream).ok().and_then(|text| {
        ["HostUrl=", "ReferrerUrl="].iter().find_map(|key| {
            text.lines()
                .find_map(|l| l.trim().strip_prefix(key))
                .and_then(host)
        })
    });
    Extra {
        added: None,
        from,
        screen_capture: false,
    }
}

pub fn host(url: &str) -> Option<String> {
    let rest = url
        .split_once("://")
        .filter(|(s, _)| matches!(s.to_ascii_lowercase().as_str(), "http" | "https" | "ftp"))
        .map(|(_, r)| r)?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let hostport = authority.rsplit('@').next()?;
    let host = if hostport.starts_with('[') {
        hostport.split(']').next().map(|h| &h[1..])?
    } else {
        hostport.split(':').next()?
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host).to_string();
    (!host.is_empty()).then_some(host)
}

#[cfg(target_os = "macos")]
fn added_time(path: &Path) -> Option<i64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    #[repr(C)]
    struct AttrList {
        bitmapcount: u16,
        reserved: u16,
        commonattr: u32,
        volattr: u32,
        dirattr: u32,
        fileattr: u32,
        forkattr: u32,
    }

    #[repr(C, packed(4))]
    struct Reply {
        length: u32,
        returned: [u32; 5],
        added: libc::timespec,
    }

    extern "C" {
        fn getattrlist(
            path: *const libc::c_char,
            list: *mut AttrList,
            buf: *mut libc::c_void,
            size: libc::size_t,
            options: u32,
        ) -> libc::c_int;
    }

    const ATTR_BIT_MAP_COUNT: u16 = 5;
    const ATTR_CMN_RETURNED_ATTRS: u32 = 0x8000_0000;
    const ATTR_CMN_ADDEDTIME: u32 = 0x1000_0000;
    const FSOPT_NOFOLLOW: u32 = 0x1;

    let c = CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut list = AttrList {
        bitmapcount: ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_ADDEDTIME,
        volattr: 0,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    };
    let mut reply = std::mem::MaybeUninit::<Reply>::zeroed();
    let rc = unsafe {
        getattrlist(
            c.as_ptr(),
            &mut list,
            reply.as_mut_ptr().cast(),
            std::mem::size_of::<Reply>(),
            FSOPT_NOFOLLOW,
        )
    };
    if rc != 0 {
        return None;
    }
    let reply = unsafe { reply.assume_init() };
    let returned = reply.returned;
    if returned[0] & ATTR_CMN_ADDEDTIME == 0 {
        return None;
    }
    let ts = reply.added;
    Some(ts.tv_sec * 1000 + ts.tv_nsec / 1_000_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts() {
        assert_eq!(
            host("https://www.example.com/a/b.pdf").as_deref(),
            Some("example.com")
        );
        assert_eq!(
            host("https://user:pw@files.example.org:8443/x").as_deref(),
            Some("files.example.org")
        );
        assert_eq!(host("blob:https://x"), None);
        assert_eq!(host("data:text/plain,hi"), None);
        assert_eq!(host("http://[::1]:8080/f").as_deref(), Some("::1"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn added_time_reads() {
        let dir = std::env::temp_dir();
        assert!(added_time(&dir).is_some());
    }
}
