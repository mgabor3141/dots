{ config, pkgs, ... }:
{
  environment.systemPath = [
    "/opt/homebrew/bin/"
  ];

  homebrew = {
    enable = true;
    onActivation = {
      autoUpdate = true;
      upgrade = true;
      cleanup = "zap";
    };

    taps = [
      "nikitabobko/tap"
    ];

    brews = [
      "chezmoi"
      "fastfetch"
      "eza"
      "yt-dlp"
      "borgbackup-fuse"
      "imagemagick"
      "flock"

      # "esptool"

      "gh"

      "volta"
      "deno"

      # "colima"
      # "helm"
      # "k3d"
      # "k9s"
      # "kind"
      # "kubernetes-cli"
      # "kustomize"
      # "minikube"
      # "terraform"

      # Dependencies (to make uninstall work correctly)
      "libb2"
      "xxhash"
      "python@3.13"
    ];

    # greedyCasks = true;
    casks = [
      "stats"
      "linearmouse"
      "blackhole-2ch"
      "karabiner-elements"
      "nikitabobko/tap/aerospace"
      "kitty"

      "macfuse"
      "vorta"
      "localsend"

      "iina"
      "chromium"
      "cursor"

      "jellyfin-media-player"
    ];
  };
}
