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

  programs.fish.enable = true;
  programs.direnv.enable = true;

  services.aerospace.enable = false;
}
