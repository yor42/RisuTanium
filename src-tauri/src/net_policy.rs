// Destination policy for native fetches made on behalf of untrusted callers.
//
// Invariants:
// - `classify` mirrors server/node/proxyPolicy.cjs rule for rule; an address
//   that the Node proxy treats as private is private here too.
// - Loopback and public destinations are always allowed; private ones only
//   when the caller opted in (`allow_private`).
// - The resolver hands back exactly the addresses it checked, so a name cannot
//   be re-resolved to a different address after the check.

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::Deserialize;
use std::io;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::Arc;

/// Prefix of every refusal text; the TypeScript side recognises it.
pub const BLOCKED_MARKER: &str = "NATIVE_DESTINATION_BLOCKED";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Loopback,
    Private,
    Public,
}

/// The wire form is `{"allowPrivate": bool}`. A malformed policy fails the
/// command's argument deserialization, so no request is made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NetPolicy {
    pub allow_private: bool,
}

/// Name lookup, injectable so tests need no real DNS.
pub type Lookup = Arc<dyn Fn(&str, u16) -> io::Result<Vec<SocketAddr>> + Send + Sync>;

pub fn system_lookup() -> Lookup {
    Arc::new(|host: &str, port: u16| {
        (host, port)
            .to_socket_addrs()
            .map(|addresses| addresses.collect())
    })
}

pub fn blocked_message(host: &str) -> String {
    format!("{} (private): {}", BLOCKED_MARKER, host)
}

fn classify_v4(bytes: [u8; 4]) -> Kind {
    let [a, b, c, d] = bytes;
    // Exactly 0.0.0.0 is how clients name "this machine".
    if a == 0 && b == 0 && c == 0 && d == 0 {
        return Kind::Loopback;
    }
    if a == 127 {
        return Kind::Loopback;
    }
    if a == 0 || a == 10 {
        return Kind::Private;
    }
    if a == 172 && (16..=31).contains(&b) {
        return Kind::Private;
    }
    if a == 192 && b == 168 {
        return Kind::Private;
    }
    if a == 169 && b == 254 {
        return Kind::Private;
    }
    // 100.64.0.0/10: carrier-grade NAT, which VPN overlays use.
    if a == 100 && (64..=127).contains(&b) {
        return Kind::Private;
    }
    // Multicast, reserved and the broadcast address.
    if a >= 224 {
        return Kind::Private;
    }
    Kind::Public
}

fn classify_v6(bytes: [u8; 16]) -> Kind {
    let zero_until = |end: usize| bytes[..end].iter().all(|byte| *byte == 0);
    let embedded = |start: usize| {
        classify_v4([
            bytes[start],
            bytes[start + 1],
            bytes[start + 2],
            bytes[start + 3],
        ])
    };
    if zero_until(16) {
        return Kind::Loopback;
    }
    if zero_until(15) && bytes[15] == 1 {
        return Kind::Loopback;
    }
    // ::ffff:0:0/96 (IPv4-mapped).
    if zero_until(10) && bytes[10] == 0xff && bytes[11] == 0xff {
        return embedded(12);
    }
    // 64:ff9b::/96 (NAT64) and the local-use 64:ff9b:1::/48.
    if bytes[0] == 0x00 && bytes[1] == 0x64 && bytes[2] == 0xff && bytes[3] == 0x9b {
        if bytes[4..12].iter().all(|byte| *byte == 0) {
            return embedded(12);
        }
        if bytes[4] == 0 && bytes[5] == 1 {
            return Kind::Private;
        }
    }
    // 2002::/16 (6to4): the IPv4 address sits in bytes 2 to 5.
    if bytes[0] == 0x20 && bytes[1] == 0x02 {
        return embedded(2);
    }
    // 2001::/32 (Teredo).
    if bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0 && bytes[3] == 0 {
        return Kind::Private;
    }
    // ::/96 other than :: and ::1 (IPv4-compatible).
    if zero_until(12) {
        return embedded(12);
    }
    // fc00::/7 (unique local), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast).
    if (bytes[0] & 0xfe) == 0xfc || bytes[0] == 0xff {
        return Kind::Private;
    }
    if bytes[0] == 0xfe && (bytes[1] & 0x80) == 0x80 {
        return Kind::Private;
    }
    Kind::Public
}

pub fn classify(address: IpAddr) -> Kind {
    match address {
        IpAddr::V4(v4) => classify_v4(v4.octets()),
        IpAddr::V6(v6) => classify_v6(v6.octets()),
    }
}

pub fn is_allowed(kind: Kind, allow_private: bool) -> bool {
    match kind {
        Kind::Loopback | Kind::Public => true,
        Kind::Private => allow_private,
    }
}

pub fn address_allowed(address: IpAddr, policy: &NetPolicy) -> bool {
    is_allowed(classify(address), policy.allow_private)
}

/// The literal host to refuse, if the URL names an IP address the policy does
/// not allow. Names are judged by the resolver instead.
pub fn literal_refusal(url: &url::Url, policy: &NetPolicy) -> Option<String> {
    let (address, text) = match url.host()? {
        url::Host::Ipv4(v4) => (IpAddr::V4(v4), v4.to_string()),
        url::Host::Ipv6(v6) => (IpAddr::V6(v6), v6.to_string()),
        url::Host::Domain(_) => return None,
    };
    if address_allowed(address, policy) {
        None
    } else {
        Some(text)
    }
}

/// Resolves a name through the injected lookup and refuses the whole answer if
/// any address is not allowed. Hyper skips the resolver for IP literals, so
/// literals are checked separately by the caller.
pub struct CheckedResolver {
    pub policy: NetPolicy,
    pub lookup: Lookup,
}

impl Resolve for CheckedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let policy = self.policy;
        let lookup = self.lookup.clone();
        let host = name.as_str().to_string();
        Box::pin(async move {
            let lookup_host = host.clone();
            let resolved = tauri::async_runtime::spawn_blocking(move || lookup(&lookup_host, 0))
                .await
                .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))??;
            if resolved
                .iter()
                .any(|socket| !address_allowed(socket.ip(), &policy))
            {
                return Err(
                    io::Error::new(io::ErrorKind::PermissionDenied, blocked_message(&host)).into(),
                );
            }
            Ok(Box::new(resolved.into_iter()) as Addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    fn kind_of(text: &str) -> Kind {
        classify(text.parse::<IpAddr>().expect("fixture must parse"))
    }

    #[test]
    fn classify_matches_the_node_proxy_vectors() {
        let cases: Vec<(&str, Kind)> = vec![
            ("0.0.0.0", Kind::Loopback),
            ("127.0.0.1", Kind::Loopback),
            ("127.255.255.254", Kind::Loopback),
            ("0.1.2.3", Kind::Private),
            ("10.0.0.1", Kind::Private),
            ("172.16.0.1", Kind::Private),
            ("172.31.255.255", Kind::Private),
            ("172.32.0.1", Kind::Public),
            ("192.168.1.1", Kind::Private),
            ("169.254.1.1", Kind::Private),
            ("100.64.0.1", Kind::Private),
            ("100.127.255.255", Kind::Private),
            ("100.128.0.1", Kind::Public),
            ("224.0.0.1", Kind::Private),
            ("255.255.255.255", Kind::Private),
            ("8.8.8.8", Kind::Public),
            ("::", Kind::Loopback),
            ("::1", Kind::Loopback),
            ("::a00:1", Kind::Private),
            ("::808:808", Kind::Public),
            ("::ffff:127.0.0.1", Kind::Loopback),
            ("::ffff:10.0.0.1", Kind::Private),
            ("::ffff:8.8.8.8", Kind::Public),
            ("64:ff9b::a00:1", Kind::Private),
            ("64:ff9b::808:808", Kind::Public),
            ("64:ff9b:1::1", Kind::Private),
            ("2002:a00:1::", Kind::Private),
            ("2002:808:808::", Kind::Public),
            ("2001::1", Kind::Private),
            ("fc00::1", Kind::Private),
            ("fd12::1", Kind::Private),
            ("fe80::1", Kind::Private),
            ("febf::1", Kind::Private),
            ("fec0::1", Kind::Private),
            ("ff02::1", Kind::Private),
            ("2606:4700::1111", Kind::Public),
        ];
        for (text, expected) in cases {
            assert_eq!(kind_of(text), expected, "classify({})", text);
        }
    }

    #[test]
    fn policy_allows_loopback_and_public_and_gates_private() {
        for allow_private in [false, true] {
            assert!(is_allowed(Kind::Loopback, allow_private));
            assert!(is_allowed(Kind::Public, allow_private));
        }
        assert!(!is_allowed(Kind::Private, false));
        assert!(is_allowed(Kind::Private, true));
    }

    #[test]
    fn net_policy_reads_camel_case_only() {
        let parse_policy = |value: serde_json::Value| serde_json::from_value::<NetPolicy>(value);
        assert_eq!(
            parse_policy(serde_json::json!({ "allowPrivate": false })).unwrap(),
            NetPolicy { allow_private: false }
        );
        assert_eq!(
            parse_policy(serde_json::json!({ "allowPrivate": true })).unwrap(),
            NetPolicy { allow_private: true }
        );
        assert!(parse_policy(serde_json::json!({ "allow_private": true })).is_err());
    }

    #[test]
    fn malformed_policy_is_rejected_not_defaulted() {
        let parse_policy = |value: serde_json::Value| serde_json::from_value::<NetPolicy>(value);
        // Wrong type, missing field, null inside the object, non-object.
        assert!(parse_policy(serde_json::json!({ "allowPrivate": "yes" })).is_err());
        assert!(parse_policy(serde_json::json!({})).is_err());
        assert!(parse_policy(serde_json::json!({ "allowPrivate": null })).is_err());
        assert!(parse_policy(serde_json::json!(true)).is_err());
        // An unknown field next to a valid one is still refused.
        assert!(
            parse_policy(serde_json::json!({ "allowPrivate": true, "extra": 1 })).is_err()
        );
    }

    #[test]
    fn optional_policy_maps_null_to_none() {
        let absent: Option<NetPolicy> = serde_json::from_value(serde_json::Value::Null).unwrap();
        assert_eq!(absent, None);
        let present: Option<NetPolicy> =
            serde_json::from_value(serde_json::json!({ "allowPrivate": true })).unwrap();
        assert_eq!(present, Some(NetPolicy { allow_private: true }));
    }

    fn fixed_lookup(address: IpAddr) -> Lookup {
        Arc::new(move |_host: &str, port: u16| Ok(vec![SocketAddr::new(address, port)]))
    }

    fn resolve_with(policy: NetPolicy, lookup: Lookup) -> Result<Vec<SocketAddr>, String> {
        let resolver = CheckedResolver { policy, lookup };
        let name: Name = "box.test".parse().expect("name must parse");
        tauri::async_runtime::block_on(resolver.resolve(name))
            .map(|addresses| addresses.collect())
            .map_err(|e| e.to_string())
    }

    #[test]
    fn resolver_refuses_a_private_resolution() {
        let lookup = fixed_lookup(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)));
        let message = resolve_with(NetPolicy { allow_private: false }, lookup.clone())
            .expect_err("private answer must be refused");
        assert!(message.contains(BLOCKED_MARKER), "got: {}", message);
        assert!(message.contains("box.test"), "got: {}", message);
        let allowed = resolve_with(NetPolicy { allow_private: true }, lookup)
            .expect("opted-in private answer must resolve");
        assert_eq!(allowed.len(), 1);
    }

    #[test]
    fn resolver_returns_exactly_the_checked_addresses() {
        let loopback = fixed_lookup(IpAddr::V4(Ipv4Addr::LOCALHOST));
        let resolved = resolve_with(NetPolicy { allow_private: false }, loopback)
            .expect("loopback must resolve");
        assert_eq!(resolved, vec![SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0)]);
        let mixed: Lookup = Arc::new(|_host: &str, port: u16| {
            Ok(vec![
                SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port),
                SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)), port),
            ])
        });
        assert!(resolve_with(NetPolicy { allow_private: false }, mixed).is_err());
    }
}
