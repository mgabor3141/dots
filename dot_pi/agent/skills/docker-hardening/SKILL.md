---
name: docker-hardening
description: Harden, audit, or safely roll out Docker containers that process untrusted input or run arbitrary code. Use for non-root execution, capability removal, no-new-privileges, read-only filesystems, writable-path design, PID 1/supervision, network and mount isolation, runtime validation, and failure-atomic container replacement.
---

# Docker hardening

Treat image metadata, launch configuration, runtime state, and upgrade behavior as one security mechanism. A secure-looking Compose file is insufficient if an alternate launcher, writable executable, broken PID 1, or failed replacement bypasses it.

## Establish the boundary

State explicitly:

- What code/input is untrusted?
- Which credentials may the container read?
- Which host paths must it write?
- Which peers and upstream destinations may it reach?
- Is container-runtime or host-root compromise in scope?
- Does arbitrary code run as the application UID?

Do not claim same-UID isolation inside one container. Keep secrets out of environment variables, writable mounts, and same-UID processes when the workload can execute arbitrary code.

## Harden the image by default

Prefer safe image metadata in addition to launcher flags:

```dockerfile
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/nonroot-entrypoint"]
```

Bake the runtime UID/GID during build. Do not retain a root bootstrap merely to run `usermod`, `chown`, or seed files at startup; prepare bind mounts on the host instead.

Audit all executable/imported content, not only its parent directory. `test ! -w /opt/app` does not detect writable descendants. Remove group/world write permissions at build time and enforce a read-only root filesystem at runtime.

## Harden the launch

Use the strongest compatible baseline:

```sh
--user 1000:1000
--cap-drop ALL
--security-opt no-new-privileges:true
--read-only
--tmpfs /tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000,mode=1777
```

Also:

- Mount only the required per-instance data directory.
- Never mount the Docker socket or broad host paths.
- Avoid host PID/IPC/network namespaces and devices.
- Use private, narrowly shared networks; publish no port unless necessary.
- Pin images by digest where reproducibility matters.
- Bound memory, PIDs, request size, concurrency, and timeouts as appropriate.
- Add `noexec` to tmpfs unless legitimate execution requires it.

A read-only root does not make bind mounts safe. Inventory every mount and its propagation/options.

A single-file bind mount pins the inode. Replacing the file on the host (`install`, `mv`, editor save-by-rename) leaves the running container on the old content; always recreate the container after rendering a mounted config file, and make validators read the effective config from inside.

## Bound egress, not just ingress

Default Docker NAT lets a bridge reach the LAN and every port other containers publish on `0.0.0.0` on the same host (admin UIs, databases, proxy entrypoints). For containers that execute untrusted code, treat egress as part of the boundary:

- Prefer an allowlist when the destination set is small (`internal: true` network plus an explicit proxy). Otherwise reject private destinations from the container's subnet via the `DOCKER-USER` chain, which Docker leaves for operator rules:

```sh
iptables -N AGENT-EGRESS
iptables -I DOCKER-USER 1 -j AGENT-EGRESS
iptables -A AGENT-EGRESS -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A AGENT-EGRESS -s 10.253.0.8/29 -d 10.253.0.8/29 -j RETURN   # same-bridge peers
for d in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10; do
  iptables -A AGENT-EGRESS -s 10.253.0.8/29 -d "$d" -j REJECT --reject-with icmp-admin-prohibited
done
```

- Same-subnet traffic on a bridge also traverses FORWARD (`bridge-nf-call-iptables=1`); return it explicitly before the rejects or you cut the container off from its own sidecars.
- REJECT, not DROP: an agent waiting on a timeout is worse than one that gets `EHOSTUNREACH` immediately.
- Rules are not persistent and dockerd recreates its chains; rebuild idempotently from the current network list at provisioning, on reconcile, and from the boot hook. Verify with a connect probe from inside the container to a host-published port and to a LAN address, plus one probe that must still succeed (same-bridge peer, public API).
- Check that everything the container legitimately needs resolves to public addresses; split-horizon DNS to a LAN IP silently breaks under this rule.
- Docker-embedded DNS (`127.0.0.11`) is answered in the namespace by dockerd and is unaffected.

## Sidecar network namespaces

`network_mode: service:<sidecar>` shares one namespace: the app can bind loopback only and still be reached through the sidecar (e.g. a userspace Tailscale `serve` proxying to `127.0.0.1`). Consequences to test rather than assume:

- Userspace netstacks (Tailscale, gVisor-style) deliver inbound connections by dialing localhost, so a loopback-only bind is still reachable from the overlay on every port with a listener, and the app sees `127.0.0.1` as the peer. Anything that treats "loopback peer" as trusted, or trusts identity headers from loopback, is now trusting every overlay peer. Keep application auth on for those paths and verify with a raw connect from a peer.
- Recreating the sidecar recreates the namespace; dependents are recreated with it. Health-check the sidecar too, or a healthy app container can sit in a dead namespace.

## Replace privileged supervisors carefully

Some images use s6 or an entrypoint that requires root capabilities. Do not blindly add `cap_drop: ALL` and accept a container that is “running” while services failed.

If replacing the supervisor:

- Start each service in its own process group.
- Forward TERM/INT to complete process groups.
- Bound graceful shutdown, then send KILL.
- Reap children.
- Exit if any required peer exits so Docker restarts the complete service set.
- Verify both normal shutdown and a peer that ignores TERM.

Prefer one service per container when practical.

## Make replacement failure-atomic

Never delete the last-known-good container before validating its replacement.

A safe host-managed transaction is:

1. Refuse unresolved rollback state.
2. Gracefully stop the old container.
3. Rename it to a rollback name.
4. Start the candidate under the canonical name.
5. Validate security properties and application readiness.
6. Remove the rollback container only after validation succeeds.
7. On any ordinary failure, remove the candidate, restore the old name, and restart it.

Set cleanup traps only after mutation begins. A trap installed too early can delete the healthy container when a preflight step fails. Preserve detectable recovery state across SIGKILL/host-loss windows.

## Validate the running container

Inspect mechanisms, not declarations:

```sh
docker inspect <container>
docker exec <container> cat /proc/1/status
docker exec <container> find /opt/app -xdev -writable -print
docker exec <container> findmnt
```

Assert:

- configured and effective UID/GID are non-root;
- `CapInh`, `CapPrm`, `CapEff`, `CapBnd`, and `CapAmb` are all zero;
- `NoNewPrivs` is `1`;
- root filesystem is read-only;
- expected entrypoint is active;
- executable/application trees have no writable descendants;
- only intended bind mounts and tmpfs paths are writable;
- required endpoints are healthy and authenticated;
- forbidden networks, mounts, devices, and ports are absent.

Enumerate every live process under `/proc`, not only PID 1, and verify privilege properties are inherited.

Validation must fail closed: a rejected candidate must not remain running or restart-enabled.

## Adversarial probes

At minimum, test:

- direct writes to code, `/etc`, and intended writable paths;
- child process capability/NNP inheritance;
- one required service crashing;
- one peer ignoring TERM;
- Docker restart recovery;
- broken image/entrypoint replacement and rollback;
- validator mutation (remove one hardening flag and ensure it fails);
- normal API, background jobs, plugins/hooks, and one real request.

Use disposable containers for destructive probes and a canary user before fleet rollout. Re-review fixes against the original reproducer.
