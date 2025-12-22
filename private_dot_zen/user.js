// Personal preferences

user_pref("signon.rememberSignons", false);
user_pref("browser.newtabpage.pinned", "[]");
user_pref("browser.translations.neverTranslateLanguages", "hu");
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("dom.security.https_only_mode", true);
user_pref("extensions.activeThemeID", "firefox-compact-dark@mozilla.org");
user_pref(
  "extensions.pictureinpicture.enable_picture_in_picture_overrides",
  true,
);
user_pref("general.autoScroll", true);
user_pref("layout.css.backdrop-filter.force-enabled", true);
user_pref("permissions.default.shortcuts", 2);
user_pref("privacy.donottrackheader.enabled", true);
user_pref("zen.urlbar.behavior", "float");
user_pref("zen.view.experimental-no-window-controls", true);
user_pref("zen.workspaces.continue-where-left-off", true);
user_pref("zen.workspaces.force-container-workspace", true);
user_pref("browser.tabs.closeWindowWithLastTab", true);
user_pref("zen.tabs.vertical.right-side", true);
user_pref("zen.urlbar.show-domain-only-in-sidebar", false);
user_pref("zen.tab-unloader.excluded-urls", "mgabor.hu");

// Options from Better Zen
// https://github.com/Codextor/better-zen/blob/main/better-zen/user.js

/* Zen value: true
 * Disables the warning when accessing about:config */
user_pref("browser.aboutConfig.showWarning", false);

/* Zen value: standard
 * Sets content blocking to strict mode - enhances privacy and security but may break some websites */
user_pref("browser.contentblocking.category", "strict");

/* Zen value: true
 * Prevents truncation of pasted text */
user_pref("editor.truncate_user_pastes", false);

/* Zen value: 0
 * Blocks all websites from sending desktop notifications by default (2=block) - improves privacy */
user_pref("permissions.default.desktop-notification", 2);

/* Zen value: 0
 * Blocks all websites from accessing location by default (2=block) - improves privacy */
user_pref("permissions.default.geo", 2);

/* Zen value: false
 * Blocks display of mixed content, ensuring that all resources on HTTPS pages are secure */
user_pref("security.mixed_content.block_display_content", true);
