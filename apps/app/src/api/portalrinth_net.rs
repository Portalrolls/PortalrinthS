//! Запросы в интернет из фронтенда, когда прямой путь не проходит.
//!
//! Фронтенд ходит в сеть через plugin-http (WebView), а тот пользуется
//! обычным системным DNS и не знает никаких обходов. Клиент лаунчера в Rust
//! умеет больше: при сетевом отказе он уточняет адрес хоста через
//! DNS-over-HTTPS (Quad9, Cloudflare, Google — см. `theseus::doh`) и
//! повторяет запрос прямо на полученные адреса, с правильным SNI и Host.
//! Та же замена «справочника», что чинит вход сменой системного DNS на
//! Quad9, — только автоматическая, без прокси и без VPN. Этой командой
//! фронтенд пользуется как запасным транспортом: сначала запрос идёт как
//! раньше, и только когда сеть отказала — вторым заходом через сюда.

use std::collections::HashMap;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use url::Url;

use theseus::api_client_builder;
use theseus::doh;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("portalrinth-net")
        .invoke_handler(tauri::generate_handler![net_fetch])
        .build()
}

#[derive(Serialize)]
struct NetResponse {
    status: u16,
    headers: Vec<(String, String)>,
    /// Тело в base64: IPC не обязан возить байты как есть, а JSON у сервиса
    /// и так доезжает в исходных байтах.
    body: String,
}

#[tauri::command]
pub async fn net_fetch(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body_base64: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<NetResponse, String> {
    let parsed_url =
        Url::parse(&url).map_err(|error| format!("Invalid URL {url}: {error}"))?;
    if parsed_url.scheme() != "https" {
        return Err("Only HTTPS URLs are allowed".to_string());
    }
    let body: Option<Vec<u8>> = match &body_base64 {
        Some(encoded) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| format!("Invalid body base64: {error}"))?,
        ),
        None => None,
    };

    if !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(&method.as_str()) {
        return Err(format!("Unsupported method {method}"));
    }

    let make_request = |client| {
        let mut request = match method.as_str() {
            "GET" => client.get(parsed_url.as_str()),
            "POST" => client.post(parsed_url.as_str()),
            "PUT" => client.put(parsed_url.as_str()),
            "PATCH" => client.patch(parsed_url.as_str()),
            "DELETE" => client.delete(parsed_url.as_str()),
            _ => client.head(parsed_url.as_str()),
        };
        if let Some(ms) = timeout_ms {
            request = request.timeout(Duration::from_millis(ms));
        }
        if let Some(headers) = &headers {
            for (name, value) in headers {
                request = request.header(name, value);
            }
        }
        if let Some(bytes) = &body {
            request = request.body(bytes.clone());
        }
        request
    };

    let base_client = api_client_builder()
        .build()
        .map_err(|error| error.to_string())?;

    let response = doh::send_with_doh_fallback_from(base_client, make_request)
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status().as_u16();
    let mut response_headers = Vec::new();
    for (name, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            response_headers.push((name.as_str().to_string(), value.to_string()));
        }
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?;

    Ok(NetResponse {
        status,
        headers: response_headers,
        body: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}
