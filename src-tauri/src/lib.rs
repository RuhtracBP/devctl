mod commands;
mod manifest;
mod pty;
mod runner;
mod worktrees;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(runner::RunningProcesses::default())
        .manage(pty::PtySessions::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_manifest,
            runner::run_action,
            runner::cancel_action,
            pty::start_interactive,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            worktrees::list_worktrees,
        ])
        .setup(|app| {
            // No macOS, devctl fica nos dois lugares: ícone de status na
            // menu bar (abre/fecha a janela) E presença normal no
            // Dock/Cmd+Tab (Regular é o policy padrão do Tauri, mas
            // deixamos explícito aqui pra documentar a decisão).
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let show_hide = MenuItem::with_id(app, "show_hide", "Mostrar/Ocultar", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_hide, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_hide" => toggle_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar a janela (botão vermelho) só esconde — o app continua
            // vivo na menu bar. Sair de verdade é só pelo menu do tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        window.hide().ok();
    } else {
        window.show().ok();
        window.set_focus().ok();
    }
}
