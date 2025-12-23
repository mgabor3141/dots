Enable Gigabyte motherboard fan control

https://docs.coolercontrol.org/hardware-support.html#motherboard-fans
https://discord.com/channels/908873022105079848/908873022105079851/1429179274623057930

```sh
sudo touch /etc/modprobe.d/it87.conf && sudo echo "options it87 ignore_resource_conflict=1" | sudo tee /etc/modprobe.d/it87.conf
sudo touch /etc/modules-load.d/it87.conf && sudo echo "it87" | sudo tee /etc/modules-load.d/it87.conf
sudo mkinitcpio -P
```

```sh
sudo sensors-detect
```

```sh
sudo systemctl stop coolercontrold.service
sudo rm -rf /etc/coolercontrol
sudo cp -r ~/.local/share/chezmoi/dot_config/org.coolercontrol.CoolerControl/.etc/coolercontrol /etc
sudo systemctl start coolercontrold.service
```
