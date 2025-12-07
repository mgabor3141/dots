{ pkgs, ... }:
{
  nix = {
    enable = true;
    # gc.automatic = true;
    optimise.automatic = true;
    settings = {
      experimental-features = "nix-command flakes";
      substituters = [
        "https://devenv.cachix.org"
        "https://nix-community.cachix.org"
        "https://cache.nixos.org/"
      ];
      trusted-public-keys = [
        "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw=" "nixpkgs-python.cachix.org-1:hxjI7pFxTyuTHn2NkvWCrAUcNZLNS3ZAvfYNuYifcEU="
        "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
      ];
    };
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
    dock.expose-animation-duration = 0.3;
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

  system.startup.chime = false;

  environment.systemPackages = [
    pkgs.nil
    pkgs.nixd
    pkgs.devenv
  ];
}
