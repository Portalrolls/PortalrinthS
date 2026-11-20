//! Minecraft servers the launcher runs on this machine.
//!
//! See `theseus::api::hosted_servers`.

use std::path::PathBuf;

use crate::api::Result;
use theseus::hosted_servers::{
    self, HostedFile, HostedFileItem, HostedPlugin, HostedServer,
    HostedServerView,
};
use tauri_plugin_dialog::DialogExt;

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("portalrinth-hosting")
        .invoke_handler(tauri::generate_handler![
            hosting_list,
            hosting_get,
            hosting_create,
            hosting_update,
            hosting_remove,
            hosting_start,
            hosting_stop,
            hosting_restart,
            hosting_republish,
            hosting_command,
            hosting_log,
            hosting_versions,
            hosting_install_core,
            hosting_plugins,
            hosting_plugin_toggle,
            hosting_plugin_remove,
            hosting_plugin_import,
            hosting_plugin_download,
            hosting_files,
            hosting_file_delete,
            hosting_file_import,
            hosting_file_items,
            hosting_file_read,
            hosting_file_write,
            hosting_file_create_dir,
            hosting_file_rename,
            hosting_file_save_as,
        ])
        .build()
}

#[tauri::command]
pub async fn hosting_list() -> Result<Vec<HostedServerView>> {
    Ok(hosted_servers::list().await?)
}

#[tauri::command]
pub async fn hosting_get(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::get(&id).await?)
}

#[tauri::command]
pub async fn hosting_create(
    name: String,
    software: String,
    game_version: String,
) -> Result<HostedServerView> {
    Ok(hosted_servers::create(name, software, game_version).await?)
}

#[tauri::command]
pub async fn hosting_update(
    id: String,
    server: HostedServer,
) -> Result<HostedServerView> {
    Ok(hosted_servers::update(&id, server).await?)
}

#[tauri::command]
pub async fn hosting_remove(id: String) -> Result<()> {
    Ok(hosted_servers::remove(&id).await?)
}

#[tauri::command]
pub async fn hosting_start(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::start(&id).await?)
}

#[tauri::command]
pub async fn hosting_stop(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::stop(&id).await?)
}

#[tauri::command]
pub async fn hosting_restart(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::restart(&id).await?)
}

#[tauri::command]
pub async fn hosting_republish(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::republish(&id).await?)
}

#[tauri::command]
pub async fn hosting_command(id: String, command: String) -> Result<()> {
    Ok(hosted_servers::command(&id, &command).await?)
}

#[tauri::command]
pub async fn hosting_disable_mods(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::set_mods_disabled(&id, true).await?)
}

#[tauri::command]
pub async fn hosting_restore_mods(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::set_mods_disabled(&id, false).await?)
}

#[tauri::command]
pub async fn hosting_log(id: String) -> Result<Vec<String>> {
    Ok(hosted_servers::log(&id))
}

#[tauri::command]
pub async fn hosting_versions(software: String) -> Result<Vec<String>> {
    Ok(hosted_servers::versions(&software).await?)
}

#[tauri::command]
pub async fn hosting_install_core(id: String) -> Result<HostedServerView> {
    Ok(hosted_servers::install_core(&id).await?)
}

#[tauri::command]
pub async fn hosting_plugins(id: String) -> Result<Vec<HostedPlugin>> {
    Ok(hosted_servers::plugins(&id).await?)
}

#[tauri::command]
pub async fn hosting_plugin_toggle(
    id: String,
    name: String,
) -> Result<Vec<HostedPlugin>> {
    Ok(hosted_servers::plugin_toggle(&id, &name).await?)
}

#[tauri::command]
pub async fn hosting_plugin_remove(
    id: String,
    name: String,
) -> Result<Vec<HostedPlugin>> {
    Ok(hosted_servers::plugin_remove(&id, &name).await?)
}

#[tauri::command]
pub async fn hosting_plugin_import(
    id: String,
    paths: Vec<PathBuf>,
) -> Result<Vec<HostedPlugin>> {
    Ok(hosted_servers::plugin_import(&id, paths).await?)
}

#[tauri::command]
pub async fn hosting_plugin_download(
    id: String,
    url: String,
    name: String,
) -> Result<Vec<HostedPlugin>> {
    Ok(hosted_servers::plugin_download(&id, &url, &name).await?)
}

#[tauri::command]
pub async fn hosting_files(id: String, path: String) -> Result<Vec<HostedFile>> {
    Ok(hosted_servers::files(&id, &path).await?)
}

#[tauri::command]
pub async fn hosting_file_delete(id: String, path: String) -> Result<()> {
    Ok(hosted_servers::file_delete(&id, &path).await?)
}

#[tauri::command]
pub async fn hosting_file_import(
    id: String,
    path: String,
    paths: Vec<PathBuf>,
) -> Result<()> {
    Ok(hosted_servers::file_import(&id, &path, paths).await?)
}

#[tauri::command]
pub async fn hosting_file_items(
    id: String,
    path: String,
) -> Result<Vec<HostedFileItem>> {
    Ok(hosted_servers::file_items(&id, &path).await?)
}

#[tauri::command]
pub async fn hosting_file_read(id: String, path: String) -> Result<Vec<u8>> {
    Ok(hosted_servers::file_read(&id, &path).await?)
}

#[tauri::command]
pub async fn hosting_file_write(
    id: String,
    path: String,
    bytes: Vec<u8>,
    create_only: bool,
) -> Result<()> {
    Ok(hosted_servers::file_write(&id, &path, &bytes, create_only).await?)
}

#[tauri::command]
pub async fn hosting_file_create_dir(id: String, path: String) -> Result<()> {
    Ok(hosted_servers::file_create_dir(&id, &path).await?)
}

#[tauri::command]
pub async fn hosting_file_rename(
    id: String,
    source: String,
    destination: String,
) -> Result<()> {
    Ok(hosted_servers::file_rename(&id, &source, &destination).await?)
}

#[tauri::command]
pub async fn hosting_file_save_as<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    path: String,
) -> Result<()> {
    let name = std::path::Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_file_name(&name).save_file(|picked| {
        let _ = tx.send(picked);
    });
    if let Some(picked) = rx.await.unwrap_or(None) {
        let destination = PathBuf::try_from(picked)
            .map_err(|_| anyhow::anyhow!("invalid save path"))?;
        hosted_servers::file_export(&id, &path, &destination).await?;
    }
    Ok(())
}
