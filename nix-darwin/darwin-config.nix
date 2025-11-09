{ config, pkgs, ... }:
{
  nix = {
    enable = true;
    # gc.automatic = true;
    optimise.automatic = true;
  };

  security.pam.services.sudo_local = {
    enable = true;
    reattach = true;
    touchIdAuth = true;
  };

  system.defaults = {
    ActivityMonitor.IconType = 5;
    LaunchServices.LSQuarantine = false;
    NSGlobalDomain.AppleInterfaceStyle = "Dark";
    NSGlobalDomain.AppleMeasurementUnits = "Centimeters";
    NSGlobalDomain.AppleTemperatureUnit = "Celsius";
    NSGlobalDomain.AppleMetricUnits = 1;
    NSGlobalDomain.ApplePressAndHoldEnabled = true;
    NSGlobalDomain._HIHideMenuBar = true;
    NSGlobalDomain.NSAutomaticPeriodSubstitutionEnabled = false;
    NSGlobalDomain.NSDocumentSaveNewDocumentsToCloud = false;
    NSGlobalDomain.NSNavPanelExpandedStateForSaveMode = true;
    NSGlobalDomain.NSNavPanelExpandedStateForSaveMode2 = true;
    NSGlobalDomain.PMPrintingExpandedStateForPrint = true;
    NSGlobalDomain.PMPrintingExpandedStateForPrint2 = true;
    NSGlobalDomain."com.apple.keyboard.fnState" = true;
    NSGlobalDomain."com.apple.mouse.tapBehavior" = 1;
    NSGlobalDomain."com.apple.sound.beep.feedback" = 0;
    NSGlobalDomain."com.apple.trackpad.forceClick" = false;
    SoftwareUpdate.AutomaticallyInstallMacOSUpdates = false;
    WindowManager.AppWindowGroupingBehavior = false;
    WindowManager.EnableStandardClickToShowDesktop = false;
    WindowManager.StandardHideDesktopIcons = true;
    WindowManager.StandardHideWidgets = true;
    controlcenter.Bluetooth = false;
    controlcenter.NowPlaying = false;
    controlcenter.Sound = false;
    dock.autohide = true;
    dock.autohide-delay = 0.001;
    dock.autohide-time-modifier = 0.1;
    dock.expose-animation-duration = 0.2;
    dock.orientation = "left";
    dock.show-recents = false;
    dock.tilesize = 32;
    dock.wvous-bl-corner = 2;
    dock.wvous-br-corner = 2;
    finder.CreateDesktop = false;
    finder.FXEnableExtensionChangeWarning = false;
    finder.FXPreferredViewStyle = "Nlsv";
    finder.FXRemoveOldTrashItems = true;
    finder.NewWindowTarget = "Home";
    finder.ShowExternalHardDrivesOnDesktop = false;
    finder.ShowHardDrivesOnDesktop = false;
    finder.ShowMountedServersOnDesktop = false;
    finder.ShowPathbar = true;
    finder.ShowRemovableMediaOnDesktop = false;
    finder._FXSortFoldersFirst = true;
    hitoolbox.AppleFnUsageType = "Do Nothing";
    # loginwindow.LoginwindowText = "";
    # loginwindow.SHOWFULLNAME = false;
    menuExtraClock.IsAnalog = true;
    screencapture.target = "clipboard";
    spaces.spans-displays = false;
    trackpad.Clicking = true;
    trackpad.TrackpadRightClick = true;
  };

  system.keyboard.enableKeyMapping = true;
  system.keyboard.nonUS.remapTilde = true;

  system.startup.chime = false;

  programs.fish.enable = true;
  programs.direnv.enable = true;

  environment.userLaunchAgents."hu.mgabor.bing-wallpaper.plist" = {
    text = ''
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
      <dict>
        <key>Label</key>
        <string>hu.mgabor.bing-wallpaper</string>

        <key>ProgramArguments</key>
        <array>
          <string>/Users/mg/.local/bin/bing-wallpaper.sh</string>
        </array>

        <key>RunAtLoad</key>
        <true/>

        <!-- Launch on each unlock event -->
        <key>LaunchEvents</key>
        <dict>
          <key>com.apple.notifyd.matching</key>
          <dict>
            <key>com.apple.screenIsUnlocked</key>
            <dict>
              <key>Notification</key>
              <string>com.apple.screenIsUnlocked</string>
            </dict>
          </dict>
        </dict>

        <key>KeepAlive</key>
        <true/>

        <key>StandardOutPath</key><string>/tmp/hu.mgabor.bing-wallpaper</string>
        <key>StandardErrorPath</key><string>/tmp/hu.mgabor.bing-wallpaper</string>

        <key>EnvironmentVariables</key>
        <dict>
          <key>PATH</key>
          <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        </dict>
      </dict>
      </plist>
    '';
  };
}
