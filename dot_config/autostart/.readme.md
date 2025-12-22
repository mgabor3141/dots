# autostart

Get list of applications

```sh
ls /usr/share/applications/ ~/.local/share/applications/
```

Add an application to autostart

```sh
ln -s /usr/share/applications/application.desktop ~/.config/autostart/application.desktop
chezmoi add ~/.config/autostart
```
