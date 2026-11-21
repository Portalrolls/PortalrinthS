use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};
use tauri::{Manager, Runtime};
use theseus::error_code;

/// Every WebView2 environment in the process must be created with the same
/// browser arguments, or the second one dies with HRESULT 0x8007139F
/// (ERROR_INVALID_STATE). The main window pins its own set through
/// tauri.conf.json, so every extra window (sign-in, built-in browser, Ely
/// skin uploads) repeats exactly the same line here.
pub const WEBVIEW_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,MediaSessionService";

/// Аргументы и папка данных для окон входа (Microsoft, Ely.by).
///
/// WebView2 не пользуется прокси, заданным в настройках лаунчера, — он ходит
/// в сеть напрямую. В России Microsoft без прокси часто отвечает ошибкой
/// («fetch failed» от самой Microsoft), поэтому когда прокси включён, окну
/// входа передаётся `--proxy-server` явно. Два окружения WebView2 с разными
/// аргументами в одной папке данных не уживаются (HRESULT 0x8007139F), так
/// что окну входа с прокси выдаётся и отдельная папка данных. Без прокси
/// поведение прежнее: общие аргументы, общий профиль (Microsoft помнит
/// прошлые входы).
///
/// Часть схем прокси Chromium не понимает (например, `socks5h://`) — она
/// приводится к ближайшей понятной; неподдерживаемое вовсе оставляет окно
/// входа без прокси, как раньше.
pub fn signin_webview<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(String, Option<std::path::PathBuf>)> {
    let Some(proxy) = theseus::effective_proxy_url() else {
        return Ok((WEBVIEW_BROWSER_ARGS.to_string(), None));
    };
    let proxy = proxy.trim();
    let proxy = proxy
        .strip_prefix("socks5h://")
        .map(|rest| format!("socks5://{rest}"))
        .unwrap_or_else(|| proxy.to_string());
    let supported = proxy.starts_with("http://")
        || proxy.starts_with("https://")
        || proxy.starts_with("socks5://")
        || proxy.starts_with("socks4://");
    if !supported {
        return Ok((WEBVIEW_BROWSER_ARGS.to_string(), None));
    }

    let data_dir = app.path().app_data_dir()?.join("signin-webview");
    Ok((
        format!("{WEBVIEW_BROWSER_ARGS} --proxy-server={proxy}"),
        Some(data_dir),
    ))
}

pub mod auth;
pub mod ely_auth;
pub mod import;
pub mod install;
pub mod instance;
pub mod jre;
pub mod logs;
pub mod metadata;
pub mod minecraft_skins;
pub mod mr_auth;
pub mod portalrinth_background;
pub mod portalrinth_clipboard;
pub mod portalrinth_crash;
pub mod portalrinth_curseforge;
pub mod portalrinth_fonts;
pub mod portalrinth_bedrock;
pub mod portalrinth_hosting;
pub mod portalrinth_lan;
pub mod portalrinth_music;
pub mod portalrinth_offline_auth;
pub mod portalrinth_archive;
pub mod portalrinth_gradle;
pub mod portalrinth_bridge;
pub mod portalrinth_recovery;
pub mod onboarding_checklist;
pub mod process;
pub mod reports;
pub mod settings;
pub mod shortcuts;
pub mod tags;
mod thumbnails;
pub mod users;
pub mod utils;
pub mod window_icon;

pub mod ads;
#[cfg(target_os = "macos")]
mod ads_occlusion_macos;
#[cfg(windows)]
mod ads_occlusion_windows;
pub mod cache;
pub mod files;
pub mod friends;
pub mod worlds;

mod oauth_utils;

pub type Result<T> = std::result::Result<T, CommandError>;

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(error: E) -> Self {
        Self(error.into())
    }
}

impl Serialize for CommandError {
    fn serialize<S>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        tracing::warn!("{:?}", self.0);

        let mut state = serializer.serialize_struct("CommandError", 2)?;
        state.serialize_field("message", &format!("{:#}", self.0))?;
        state.serialize_field("code", error_code(&self.0))?;
        state.end()
    }
}
