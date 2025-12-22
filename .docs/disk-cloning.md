# Disk cloning

[Clonezilla](https://clonezilla.org/) create image from disk

Can restore directly to disk with clonezilla. Alternatively mount disk and copy files to new OS install.

To view disks and their mountpoints:

```sh
lsblk
```

https://www.simplified.guide/linux/disk-mount

To mount clonezilla image:

https://blog.paymaan.com/2023/08/23/how-to-mount-partclone-clonezilla-backup-images-on-linux/

```sh
zstd -d /mnt/backup-256/mg/2025-12-21-12-img/nvme0n1p2.xfs-ptcl-img.zst --stdout | sudo partclone.restore -Co ~/os-backup/os-backup.img

sudo mkdir /mnt/backup-256-files
sudo mount -o loop,ro ~/os-backup/os-backup.img /mnt/backup-256-files
```
