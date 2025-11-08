{ config, pkgs, ... }:
{
  nix = {
    enable = true;
    gc.automatic = true;
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
    dock.autohide-time-modifier = 3.0;
    dock.expose-animation-duration = 3.0;
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
    spaces.spans-displays = true;
    trackpad.Clicking = true;
    trackpad.TrackpadRightClick = true;
  };

  system.keyboard.enableKeyMapping = true;
  system.keyboard.nonUS.remapTilde = true;

  system.startup.chime = false;

  programs.fish.enable = true;
  programs.direnv.enable = true;
}
