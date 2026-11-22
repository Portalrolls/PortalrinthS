//! DNS-over-HTTPS fallback — the Quad9 trick, built into the launcher.
//!
//! In some networks the system resolver hands out dead addresses for other
//! people's domains, or the route to them is cut on the way: requests hang or
//! get reset while the service itself is fine. Changing the system DNS to
//! Quad9 fixes that — which means the same fix works without touching the
//! system at all: ask Quad9 (then Cloudflare, then Google) for the address
//! over HTTPS, and connect straight to what they answer, with the right SNI
//! and Host. No proxy, no VPN — same internet, address just taken from a
//! different phone book.
//!
//! The DoH resolvers are queried by literal IP, so there is no chicken-and-egg
//! of needing DNS to find the thing that replaces DNS. Nothing here runs on
//! the happy path: a request first goes out the way it always did, and the
//! DoH round-trip happens only after the direct attempt already failed.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use parking_lot::RwLock;
use reqwest::{Client, RequestBuilder};

/// DoH resolvers, tried in order. Literal addresses on purpose: asking where
/// the address book is must not itself need the address book.
const DOH_ENDPOINTS: &[&str] = &[
    "https://9.9.9.9:5053/dns-query", // Quad9 (JSON API)
    "https://1.1.1.1/dns-query",      // Cloudflare
    "https://8.8.8.8/resolve",        // Google
];

/// How long a successful answer is trusted before asking again. DNS records
/// live minutes; ten is long enough to spare the resolvers, short enough that
/// a service moving hosts is noticed the same day.
const POSITIVE_TTL: Duration = Duration::from_secs(600);

/// How long to remember that nothing answered, so a dead resolver does not
/// turn every failed request into three extra DoH round-trips.
const NEGATIVE_TTL: Duration = Duration::from_secs(120);

struct CacheEntry {
    addrs: Vec<IpAddr>,
    expires: Instant,
}

static CACHE: LazyLock<RwLock<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// The addresses DoH last answered for this host. Empty when nothing answered
/// (or the host is a literal address already — nothing to ask about).
pub async fn resolve_host(host: &str) -> Vec<IpAddr> {
    if host.parse::<IpAddr>().is_ok() {
        return Vec::new();
    }

    {
        let cache = CACHE.read();
        if let Some(entry) = cache.get(host) {
            if entry.expires > Instant::now() {
                return entry.addrs.clone();
            }
        }
    }

    let addrs = query_resolvers(host).await;
    let ttl = if addrs.is_empty() {
        NEGATIVE_TTL
    } else {
        POSITIVE_TTL
    };
    CACHE.write().insert(
        host.to_string(),
        CacheEntry {
            addrs: addrs.clone(),
            expires: Instant::now() + ttl,
        },
    );
    addrs
}

async fn query_resolvers(host: &str) -> Vec<IpAddr> {
    static DOH_CLIENT: LazyLock<Client> = LazyLock::new(|| {
        // no_proxy() on purpose: the DoH attempt is the "no proxy worked"
        // path, and an environment proxy must not drag it down with it.
        Client::builder()
            .no_proxy()
            .connect_timeout(Duration::from_secs(5))
            .read_timeout(Duration::from_secs(5))
            .user_agent(crate::launcher_user_agent())
            .build()
            .expect("DoH client configuration should be valid")
    });

    for endpoint in DOH_ENDPOINTS {
        let request = DOH_CLIENT
            .get(format!("{endpoint}?name={host}&type=A"))
            .header("Accept", "application/dns-json");
        let Ok(response) = request.send().await else {
            continue;
        };
        let Ok(value) = response.json::<serde_json::Value>().await else {
            continue;
        };

        let mut addrs = Vec::new();
        if let Some(answers) = value.get("Answer").and_then(|a| a.as_array()) {
            for answer in answers {
                // Only A records (type 1); CNAMEs in the answer chain parse
                // as domains, not addresses, and are skipped by the same test
                let is_ipv4 = answer.get("type").and_then(|t| t.as_u64()) == Some(1);
                if let (true, Some(data)) = (
                    is_ipv4,
                    answer.get("data").and_then(|d| d.as_str()),
                ) {
                    if let Ok(ip) = data.parse::<IpAddr>() {
                        addrs.push(ip);
                    }
                }
            }
        }

        if !addrs.is_empty() {
            tracing::info!(
                "DoH fallback: {endpoint} resolved {host} to {} address(es)",
                addrs.len()
            );
            return addrs;
        }
    }

    tracing::warn!("DoH fallback: no resolver could answer for {host}");
    Vec::new()
}

/// A client that connects to `host` only through the addresses DoH provided.
/// Everything else — TLS, headers, timeouts — is the launcher's usual client,
/// so a pinned connection looks to the server exactly like a normal one.
fn pinned_client(host: &str, addrs: &[IpAddr]) -> Option<Client> {
    if addrs.is_empty() {
        return None;
    }
    let sock_addrs: Vec<SocketAddr> = addrs
        .iter()
        .map(|ip| SocketAddr::new(*ip, 443))
        .collect();
    crate::util::fetch::api_client_builder()
        .resolve_to_addrs(host, &sock_addrs)
        .build()
        .ok()
}

/// Sends a request the usual way, and when the network itself refuses it
/// (connect, DNS, timeout — anything that happened before an answer came
/// back) retries once through DoH-resolved addresses. Errors of the body or
/// decoding happened after a response arrived, so they are returned as is.
///
/// With a proxy configured the direct road is not the road this fixes, so the
/// error is returned untouched there too.
pub async fn send_with_doh_fallback(
    make_request: impl Fn(Client) -> RequestBuilder,
) -> Result<reqwest::Response, reqwest::Error> {
    send_with_doh_fallback_from(
        crate::util::fetch::INSECURE_REQWEST_CLIENT.clone(),
        make_request,
    )
    .await
}

/// The same, with the first attempt going through a caller-provided client —
/// used by places that need settings of their own (a stricter timeout, say).
pub async fn send_with_doh_fallback_from(
    base_client: Client,
    make_request: impl Fn(Client) -> RequestBuilder,
) -> Result<reqwest::Response, reqwest::Error> {
    match make_request(base_client).send().await {
        Ok(response) => Ok(response),
        Err(error) => {
            if error.is_body() || error.is_decode() {
                return Err(error);
            }
            if crate::util::fetch::effective_proxy_url().is_some() {
                return Err(error);
            }
            let Some(url) = error.url().cloned() else {
                return Err(error);
            };
            if url.scheme() != "https" {
                return Err(error);
            }
            let Some(host) = url.host_str().map(|h| h.to_owned()) else {
                return Err(error);
            };

            let addrs = resolve_host(&host).await;
            let Some(client) = pinned_client(&host, &addrs) else {
                return Err(error);
            };

            tracing::info!(
                "Direct request to {host} failed ({error}); retrying through DoH-resolved addresses"
            );
            make_request(client).send().await
        }
    }
}
