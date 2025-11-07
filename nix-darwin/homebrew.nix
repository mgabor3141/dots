{ config, pkgs, ... }:
{
  homebrew.enable = true;
  homebrew = {
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
      "fish"
      "eza"
      "fastfetch"

      "yt-dlp"
      "borgbackup-fuse"

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

    casks = [
      "stats"
      "unnaturalscrollwheels"
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
