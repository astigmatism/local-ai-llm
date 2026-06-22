# Local AI Host Baseline Documentation

**Host name:** `local-ai-host`  
**Primary user observed during setup:** `astigmatism`  
**Document date:** 2026-06-22  
**Purpose:** Baseline documentation for a headless Ubuntu/NVIDIA/Docker AI workstation after initial host, Docker, GPU, Portainer, and console-dashboard setup.

This document records the current known state of the machine at the end of the baseline setup. It is intended for both a human administrator and future AI assistants. Treat this as the source of truth for the initial configuration unless a newer manifest or explicit change log supersedes it.

---

## 1. Executive summary

This machine is a clean Ubuntu 26.04 LTS minimal installation configured as a single-node local AI experimentation host.

The host currently has:

- Ubuntu 26.04 LTS `resolute`
- Linux kernel `7.0.0-22-generic`
- Two NVIDIA GPUs installed and working:
  - NVIDIA GeForce RTX 4080 SUPER, 16 GB class VRAM
  - NVIDIA GeForce RTX 3090, 24 GB class VRAM
- NVIDIA open kernel driver package branch `595`
- Docker Engine installed from Docker's official apt repository
- Docker Compose v2 installed as the Docker CLI plugin
- NVIDIA Container Toolkit configured for Docker GPU access
- Docker daemon log rotation configured using the `local` log driver
- A home-directory AI workspace at `/home/astigmatism/ai`
- A Docker management workspace at `/home/astigmatism/apps/docker-management`
- Portainer CE LTS running as a Docker Compose project and exposed to the home LAN on HTTPS port `9443`
- A local physical-display console dashboard on TTY1 running `btop`
- A normal local admin login console retained on TTY2

The host is ready for Docker Compose based AI workloads. Important AI services should be defined in project folders with `compose.yaml`, `.env`, README files, pinned image tags where practical, and persistent host mounts for models, datasets, outputs, and caches.

---

## 2. Core operating principles for this machine

### 2.1 Compose files are the source of truth

Use `docker compose` project folders as the reproducible source of truth for AI services.

Portainer is installed as a convenience UI for visibility and light administration, but it should not become the only record of how a service is configured.

Use Portainer for:

- Viewing containers
- Checking logs
- Restarting services
- Inspecting images, volumes, networks, and resource usage
- Light one-off inspection

Prefer project-owned Compose files for:

- Defining AI services
- Defining GPU assignment
- Defining volume mounts
- Defining network exposure
- Rebuilding services
- Moving services to another host
- Keeping a reproducible record of configuration

Avoid manually changing important Compose-managed services in the Portainer UI unless the same change is also captured in the owning project files.

### 2.2 Keep CUDA and Python inside containers

The host provides:

- Ubuntu OS
- NVIDIA driver
- Docker Engine
- Docker Compose plugin
- NVIDIA Container Toolkit
- Basic system monitoring
- Persistent directories

The host should not normally contain global AI Python environments, global Conda installs, global CUDA toolkit installs, or project-specific Python packages. Keep Python versions, CUDA user-space libraries, PyTorch, TensorFlow, JAX, vLLM, llama.cpp, ComfyUI, and similar stacks inside containers.

### 2.3 Use stable GPU UUID assignment

For multi-GPU workloads, use NVIDIA GPU UUIDs rather than numeric GPU indices when assigning GPUs to Compose services.

Numeric indices such as `0` and `1` can change after:

- Adding GPUs
- Removing GPUs
- Moving cards between slots
- BIOS/firmware changes
- Driver changes
- PCIe topology changes

GPU UUIDs are more stable and should be recorded in `.env` files and GPU maps.

### 2.4 Prefer localhost binding for AI web UIs unless intentionally exposing to LAN

Most AI web UIs are not designed as hardened multi-user web applications. By default, bind them to `127.0.0.1` and access them by SSH tunnel unless there is a deliberate decision to expose them on the home LAN.

For Portainer, this host intentionally exposes the UI on the home LAN at a specific host IP. Do not forward Portainer to the public internet.

### 2.5 Avoid destructive cleanup by default

Do not run these casually:

```bash
docker system prune -a --volumes
```

or other volume/image cleanup commands unless backups and ownership of the data are understood. Local model weights, outputs, and Docker volumes may represent meaningful state.

---

## 3. Operating system baseline

### 3.1 OS information

Verified output during setup:

```text
Distributor ID: Ubuntu
Description:    Ubuntu 26.04 LTS
Release:        26.04
Codename:       resolute
```

Kernel:

```text
Linux local-ai-host 7.0.0-22-generic #22-Ubuntu SMP PREEMPT_DYNAMIC Mon May 25 15:54:34 UTC 2026 x86_64 GNU/Linux
```

The installation is an Ubuntu minimal install. The login banner indicated:

```text
This system has been minimized by removing packages and content that are
not required on a system that users do not log into.
```

The machine has OpenSSH and is administered primarily over SSH.

### 3.2 Secure Boot

Verified during preflight:

```text
SecureBoot disabled
```

This simplified NVIDIA driver loading because kernel module signing/MOK enrollment was not required.

### 3.3 Boot target and console mode

Observed during console dashboard setup:

```text
systemctl get-default
# graphical.target
```

Despite `graphical.target`, no active display manager was shown in the status check. The system is effectively console-oriented for local display purposes.

---

## 4. Storage and filesystem baseline

### 4.1 Disk layout

Verified storage layout:

```text
NAME         SIZE TYPE FSTYPE MOUNTPOINTS FSUSE% FSAVAIL
nvme0n1      1.1T disk
├─nvme0n1p1    1G part vfat   /boot/efi       1%      1G
└─nvme0n1p2  1.1T part ext4   /               3% 1009.3G
```

Filesystem usage at the time of inspection:

```text
Filesystem     Type  Size  Used Avail Use% Mounted on
/dev/nvme0n1p2 ext4  1.1T   33G 1010G   4% /
```

### 4.2 LVM status and practical impact

The system is using a simple partition layout, not an LVM root volume. There is no evidence of unused space stranded by disabling LVM during installation. The main ext4 filesystem consumes essentially the whole NVMe drive.

Current path placement:

- `/` is on `/dev/nvme0n1p2`
- `/home` is on `/dev/nvme0n1p2`
- `/home/astigmatism/ai` is on `/dev/nvme0n1p2`
- `/var/lib/docker` is on `/dev/nvme0n1p2`

This means Docker images, Docker layers, AI workspaces, model caches, generated outputs, and home-directory app files all share the same large root filesystem.

### 4.3 Practical storage implications

Pros:

- Simple layout
- Nearly the whole disk available to workloads
- No LVM resizing needed
- No immediate storage bottleneck observed

Tradeoffs:

- Docker storage and AI model storage share the same filesystem
- Heavy image builds and model downloads can fill the root filesystem if not monitored
- There is no separate data volume isolation

Recommended monitoring commands:

```bash
df -h
sudo du -h -d 1 /home/astigmatism/ai | sort -h
docker system df
```

---

## 5. NVIDIA GPU baseline

### 5.1 Installed GPUs

PCI preflight showed:

```text
1a:00.0 3D controller: NVIDIA Corporation AD103 [GeForce RTX 4080 SUPER] (rev a1)
1a:00.1 Audio device: NVIDIA Corporation AD103 High Definition Audio Controller (rev a1)
68:00.0 VGA compatible controller: NVIDIA Corporation GA102 [GeForce RTX 3090] (rev a1)
68:00.1 Audio device: NVIDIA Corporation GA102 High Definition Audio Controller (rev a1)
```

`nvidia-smi` after driver setup showed both GPUs:

```text
GPU 0: NVIDIA GeForce RTX 4080 SUPER, 16376 MiB
GPU 1: NVIDIA GeForce RTX 3090, 24576 MiB
```

### 5.2 NVIDIA driver

Installed driver package:

```text
nvidia-driver-595-open 595.71.05-0ubuntu0.26.04.1
```

`nvidia-smi` reported:

```text
NVIDIA-SMI 595.71.05
Driver Version: 595.71.05
CUDA Version: 13.2
```

The loaded module information showed:

```text
filename: /lib/modules/7.0.0-22-generic/updates/dkms/nvidia.ko.zst
version: 595.71.05
license: Dual MIT/GPL
```

The `Dual MIT/GPL` license indicates the open kernel module path.

### 5.3 Nouveau status

`lsmod` showed NVIDIA modules and no active `nouveau` module in the output:

```text
nvidia_uvm
nvidia_drm
nvidia_modeset
nvidia
```

### 5.4 GPU inventory with UUIDs

Saved GPU inventory manifest:

```text
/home/astigmatism/apps/docker-management/manifests/gpu-inventory-2026-06-21-224912.csv
```

Current GPU UUIDs:

| Index at baseline | UUID | Name | Bus ID | Memory | Driver |
|---:|---|---|---|---:|---|
| 0 | `GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75` | NVIDIA GeForce RTX 4080 SUPER | `00000000:1A:00.0` | 16376 MiB | 595.71.05 |
| 1 | `GPU-358353dd-5933-1dc6-ac0d-e1189b063e4c` | NVIDIA GeForce RTX 3090 | `00000000:68:00.0` | 24576 MiB | 595.71.05 |

GPU map file:

```text
/home/astigmatism/apps/docker-management/manifests/gpu-map.md
```

Current friendly mapping:

| Friendly name | GPU UUID | Physical card | Intended use |
|---|---|---|---|
| `gpu-image-main` | `GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75` | RTX 4080 SUPER, bus `00000000:1A:00.0`, 16376 MiB | Image/video generation or CUDA experiments |
| `gpu-llm-main` | `GPU-358353dd-5933-1dc6-ac0d-e1189b063e4c` | RTX 3090, bus `00000000:68:00.0`, 24576 MiB | LLM/model-serving workloads needing more VRAM |

### 5.5 Recommended GPU monitoring commands

```bash
nvidia-smi
watch -n 2 nvidia-smi
nvidia-smi pmon -c 1 || true
nvidia-smi dmon -s pucvmet -c 5 || true
nvtop
```

---

## 6. Docker baseline

### 6.1 Docker installation source

Docker Engine was installed from Docker's official apt repository, not Ubuntu's `docker.io` package.

Conflicting distribution packages were removed first:

```bash
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt-get remove -y "$pkg" || true
done
```

Docker's official apt repository was then added under:

```text
/etc/apt/sources.list.d/docker.sources
/etc/apt/keyrings/docker.asc
```

### 6.2 Docker versions

Verified Docker versions:

```text
Client: Docker Engine - Community
 Version:           29.6.0
 API version:       1.55
 Go version:        go1.26.4
 Git commit:        fb59821
 OS/Arch:           linux/amd64
 Context:           default

Server: Docker Engine - Community
 Engine:
  Version:          29.6.0
  API version:      1.55
  Go version:       go1.26.4
  Git commit:       70eaf5e
  OS/Arch:          linux/amd64
  Experimental:     false

containerd:
  Version:          v2.2.5

runc:
  Version:          1.3.6

docker-init:
  Version:          0.19.0
```

Compose:

```text
Docker Compose version v5.1.4
```

Important: use `docker compose` with a space. Do not install or use the old standalone `docker-compose` v1 binary.

### 6.3 Docker daemon configuration

Verified Docker info:

```text
Server Version: 29.6.0
Storage Driver: overlayfs
Logging Driver: local
Cgroup Driver: systemd
Runtimes: nvidia runc io.containerd.runc.v2
Default Runtime: runc
Docker Root Dir: /var/lib/docker
```

Docker log rotation was configured by merging the following effective logging configuration into `/etc/docker/daemon.json`:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  }
}
```

The NVIDIA Container Toolkit also modified Docker runtime configuration through:

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

To inspect the live daemon configuration:

```bash
cat /etc/docker/daemon.json | jq . || cat /etc/docker/daemon.json
```

### 6.4 Non-root Docker access

The user `astigmatism` is in the `docker` group.

Observed group membership:

```text
astigmatism adm cdrom sudo dip plugdev users lxd docker
```

Security note: membership in the `docker` group is effectively root-equivalent on the host because Docker can mount host paths and control privileged containers.

### 6.5 Docker smoke tests already passed

Basic Docker smoke test:

```bash
docker run --rm hello-world
```

GPU container test:

```bash
docker run --rm --gpus all nvidia/cuda:13.3.0-base-ubuntu26.04 nvidia-smi
```

Generic Ubuntu GPU container test:

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

Both CUDA and Ubuntu container GPU visibility tests passed and saw both GPUs.

---

## 7. NVIDIA Container Toolkit baseline

The NVIDIA Container Toolkit is installed and configured.

Package version captured in the host manifest:

```text
nvidia-container-toolkit 1.19.1-1
```

Docker runtime list includes `nvidia`:

```text
Runtimes: nvidia runc io.containerd.runc.v2
Default Runtime: runc
```

Default runtime remains `runc`, which is acceptable. GPU access is requested explicitly per container or Compose service.

Example explicit GPU run command:

```bash
docker run --rm --gpus all nvidia/cuda:13.3.0-base-ubuntu26.04 nvidia-smi
```

---

## 8. AI workspace layout

### 8.1 Root path

This host uses the logged-in user's home directory for customized/local runtime assets rather than `/srv/ai`.

Primary AI workspace:

```text
/home/astigmatism/ai
```

This differs from many generic runbooks that use `/srv/ai`. Future assistants must not assume `/srv/ai` is the active workspace on this host.

### 8.2 Directory layout

Created layout:

```text
/home/astigmatism/ai/
  experiments/   One subfolder per Docker Compose project or experiment
  models/        Shared model weights, checkpoints, LoRAs, embeddings
  datasets/      Shared datasets, preferably read-only inside containers
  outputs/       Generated images, videos, logs, eval results
  cache/         Hugging Face, Torch, pip, uv, npm, model caches
  logs/          Host-level logs or exported container logs
  secrets/       Local-only secrets; chmod 700; do not commit
  manifests/     Host and experiment manifests for reproducibility
  images/        Optional exported Docker images or build artifacts
```

`/home/astigmatism/ai/secrets` was set to mode `700`.

### 8.3 Existing experiment projects

Current files found after setup:

```text
/home/astigmatism/ai/experiments/gpu-smoke-test/compose.yaml
/home/astigmatism/ai/experiments/gpu-smoke-test/docker-images.txt
/home/astigmatism/ai/experiments/gpu-smoke-test/git-commit.txt
/home/astigmatism/ai/experiments/gpu-smoke-test/resolved-compose.yaml
/home/astigmatism/ai/experiments/template-pytorch/.dockerignore
/home/astigmatism/ai/experiments/template-pytorch/.env
/home/astigmatism/ai/experiments/template-pytorch/Dockerfile
/home/astigmatism/ai/experiments/template-pytorch/app.py
/home/astigmatism/ai/experiments/template-pytorch/compose.yaml
/home/astigmatism/ai/experiments/template-pytorch/docker-images.txt
/home/astigmatism/ai/experiments/template-pytorch/git-commit.txt
/home/astigmatism/ai/experiments/template-pytorch/resolved-compose.yaml
/home/astigmatism/ai/manifests/host-baseline-2026-06-21-215448.txt
```

`git-commit.txt` may be empty because these test folders are not Git repositories. That is expected.

### 8.4 Host baseline manifest

Host baseline manifest was written to:

```text
/home/astigmatism/ai/manifests/host-baseline-2026-06-21-215448.txt
```

It contains OS, kernel, GPU, Docker, Compose, Docker daemon, and relevant package information from the baseline state.

---

## 9. Existing AI smoke-test projects

### 9.1 GPU smoke test

Path:

```text
/home/astigmatism/ai/experiments/gpu-smoke-test
```

Purpose: verify Docker Compose can reserve a GPU and run `nvidia-smi` inside a CUDA container.

Compose file content:

```yaml
services:
  test:
    image: nvidia/cuda:13.3.0-base-ubuntu26.04
    command: nvidia-smi
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

Test result: passed. The container saw GPU 0, the RTX 4080 SUPER. Seeing one GPU is expected because the Compose file requested `count: 1`.

### 9.2 PyTorch CUDA template

Path:

```text
/home/astigmatism/ai/experiments/template-pytorch
```

Purpose: verify Python, PyTorch, CUDA, and GPU matrix multiplication inside a container.

Observed successful output:

```text
torch: 2.11.0+cu128
torch cuda build: 12.8
cuda available: True
gpu: NVIDIA GeForce RTX 4080 SUPER
matmul checksum: -40.27611541748047
```

The PyTorch test requested one GPU, so it saw the RTX 4080 SUPER. Earlier `--gpus all` tests confirmed both GPUs are available to Docker.

Important template behavior:

- Uses `python:3.12-slim-bookworm`
- Installs PyTorch 2.11.0 CUDA 12.8 wheels
- Mounts persistent host paths from `${AI_ROOT}`
- Uses `ipc: host` and `shm_size: 16gb`
- Requests one NVIDIA GPU with Compose reservations
- Binds web UI placeholder port to `127.0.0.1:${WEB_PORT}:7860`

---

## 10. Docker management workspace

### 10.1 Root path

Management workspace:

```text
/home/astigmatism/apps/docker-management
```

This is distinct from the AI workspace. Keep management tooling under `~/apps/docker-management`; keep AI experiments, model weights, datasets, outputs, and caches under `~/ai`.

### 10.2 Directory layout

Current management layout:

```text
/home/astigmatism/apps/docker-management/
  portainer/          Portainer Compose project
  manifests/          GPU inventory and GPU map
  gpu-compose-test/   Reusable GPU assignment smoke test
```

Directory mode for the root management folder was set to `700`.

---

## 11. GPU Compose assignment test project

### 11.1 Path

```text
/home/astigmatism/apps/docker-management/gpu-compose-test
```

### 11.2 Purpose

This project validates that Docker Compose GPU reservations work in three patterns:

1. All GPUs
2. One arbitrary GPU by count
3. One specific GPU by UUID

### 11.3 `.env`

Current `.env` values:

```dotenv
GPU_TEST_DEVICE=GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75
CUDA_SMOKE_IMAGE=nvidia/cuda:13.3.0-base-ubuntu26.04
```

### 11.4 `compose.yaml`

```yaml
name: gpu-compose-test

services:
  all-gpus:
    image: ${CUDA_SMOKE_IMAGE}
    command: nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]

  one-gpu-by-count:
    image: ${CUDA_SMOKE_IMAGE}
    command: nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  one-gpu-by-id:
    image: ${CUDA_SMOKE_IMAGE}
    command: nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              device_ids:
                - "${GPU_TEST_DEVICE}"
              capabilities: [gpu]
```

### 11.5 Test results

`all-gpus` result:

```text
index, uuid, name, memory.total [MiB]
0, GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75, NVIDIA GeForce RTX 4080 SUPER, 16376 MiB
1, GPU-358353dd-5933-1dc6-ac0d-e1189b063e4c, NVIDIA GeForce RTX 3090, 24576 MiB
```

`one-gpu-by-count` result:

```text
index, uuid, name, memory.total [MiB]
0, GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75, NVIDIA GeForce RTX 4080 SUPER, 16376 MiB
```

`one-gpu-by-id` result:

```text
index, uuid, name, memory.total [MiB]
0, GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75, NVIDIA GeForce RTX 4080 SUPER, 16376 MiB
```

Success criteria satisfied:

- Compose can expose all GPUs
- Compose can expose one arbitrary GPU
- Compose can target a specific GPU by UUID

Note: `docker compose config` may render `count: all` internally as `count: -1`; this is expected.

---

## 12. Portainer baseline

### 12.1 Purpose

Portainer CE LTS is installed as a visual management and inspection tool for the local Docker host.

Use Portainer for convenience, not as the only source of service definitions.

### 12.2 Path

Portainer Compose project:

```text
/home/astigmatism/apps/docker-management/portainer
```

### 12.3 Network exposure

Portainer is intentionally exposed to the home LAN at:

```text
https://192.168.1.21:9443
```

The binding is to the specific LAN IP `192.168.1.21`, not `0.0.0.0`.

Observed `docker compose ps` port mapping:

```text
192.168.1.21:9443->9443/tcp
```

Portainer also shows internal container ports `8000/tcp` and `9000/tcp`, but they are not published to the host by this Compose file.

### 12.4 LAN IP selection

The host Wi-Fi interface had two addresses:

```text
wlp27s0 UP 192.168.1.21/24 192.168.1.156/24 metric 600
```

Detailed check showed:

```text
inet 192.168.1.21/24 ... valid_lft forever preferred_lft forever
inet 192.168.1.156/24 ... secondary dynamic ...
```

Therefore Portainer was bound to `192.168.1.21`, the static/manual-looking address, not the secondary DHCP address `192.168.1.156`.

### 12.5 Portainer `.env`

```dotenv
PORTAINER_BIND_IP=192.168.1.21
PORTAINER_HTTPS_PORT=9443
PORTAINER_IMAGE=portainer/portainer-ce:lts
```

### 12.6 Portainer `compose.yaml`

```yaml
name: portainer

services:
  portainer:
    container_name: portainer
    image: ${PORTAINER_IMAGE:-portainer/portainer-ce:lts}
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "${PORTAINER_BIND_IP:-127.0.0.1}:${PORTAINER_HTTPS_PORT:-9443}:9443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data

volumes:
  portainer_data:
    name: portainer_data
```

### 12.7 Portainer volume

Docker volume:

```text
portainer_data
```

This volume stores Portainer's local database and configuration. Treat backups of this volume as sensitive because they may include endpoint configuration, registry settings, stack definitions, and operational metadata.

### 12.8 Portainer verification

Host check succeeded:

```bash
curl -k -I https://192.168.1.21:9443 | head -n 5
```

Observed:

```text
HTTP/1.1 200 OK
```

If a browser shows:

```text
Client sent an HTTP request to an HTTPS server.
```

then the browser used `http://` instead of `https://`. Use exactly:

```text
https://192.168.1.21:9443
```

A browser self-signed certificate warning is expected unless a trusted certificate is later configured.

### 12.9 Portainer security posture

Portainer is powerful because it has access to the Docker socket:

```text
/var/run/docker.sock:/var/run/docker.sock
```

Anyone who authenticates to Portainer can effectively control Docker on this host. Do not expose Portainer outside the trusted home network. Do not forward TCP port `9443` from the router to the internet.

Recommended additional hardening:

- Use a strong Portainer admin password
- Do not reuse passwords
- Avoid router port forwarding for Portainer
- Consider a reverse proxy with real TLS and authentication only if needed later
- Keep Portainer updated intentionally, with backups

### 12.10 Portainer backup command

To back up Portainer's Docker volume:

```bash
set -euo pipefail

cd "$HOME/apps/docker-management/portainer"
mkdir -p backups

docker compose down

docker run --rm \
  -v portainer_data:/data:ro \
  -v "$PWD/backups:/backup" \
  ubuntu \
  tar czf "/backup/portainer_data-$(date +%F-%H%M%S).tgz" -C /data .

docker compose up -d
ls -lh backups
```

Perform a backup after initial Portainer admin setup and before major Portainer upgrades.

---

## 13. Local physical display dashboard

### 13.1 Goal

The local display should show a live resource dashboard by default, similar to an appliance console.

### 13.2 Installed tool

`btop` is installed from Ubuntu packages.

Verified:

```text
/usr/bin/btop
btop version: 1.4.6
```

### 13.3 Dedicated dashboard user

A dedicated system user was created:

```text
btop-dashboard:x:999:986::/var/lib/btop-dashboard:/usr/sbin/nologin
```

This user is low privilege and is not intended for interactive login.

### 13.4 Wrapper script

Path:

```text
/usr/local/bin/btop-dashboard
```

Content:

```bash
#!/usr/bin/env bash
set -euo pipefail

export HOME=/var/lib/btop-dashboard
export TERM=linux

cd "$HOME"
exec /usr/bin/btop
```

Permissions:

```text
-rwxr-xr-x 1 root root /usr/local/bin/btop-dashboard
```

### 13.5 Systemd service

Service template:

```text
/etc/systemd/system/btop-dashboard@.service
```

Content:

```ini
[Unit]
Description=btop dashboard on %I
Documentation=man:btop(1)
Conflicts=getty@%i.service
After=systemd-user-sessions.service

[Service]
Type=simple
User=btop-dashboard
Group=btop-dashboard
ExecStart=/usr/local/bin/btop-dashboard
Restart=always
RestartSec=2
TTYPath=/dev/%I
StandardInput=tty
StandardOutput=tty
StandardError=journal
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes

[Install]
WantedBy=multi-user.target
```

Enabled instance:

```text
btop-dashboard@tty1.service
```

The service was enabled and started successfully:

```text
ActiveState=active
SubState=running
NRestarts=0
MainPID=11202
11202 /usr/bin/btop
```

### 13.6 TTY behavior

Current behavior:

- TTY1 runs the automatic `btop` dashboard
- TTY2 remains a normal admin login console

Useful local keyboard commands:

```text
Ctrl+Alt+F1 -> dashboard
Ctrl+Alt+F2 -> normal admin login prompt
```

The requested future behavior of "press any key to dismiss btop and later restore it like a screensaver" has not been implemented. The current implementation is a reliable boot-time dashboard plus separate admin TTY.

### 13.7 Temporarily stop dashboard and restore TTY1 login

```bash
sudo systemctl stop btop-dashboard@tty1.service
sudo systemctl start getty@tty1.service
```

### 13.8 Permanently undo dashboard behavior

```bash
sudo systemctl disable --now btop-dashboard@tty1.service
sudo systemctl enable --now getty@tty1.service
```

---

## 14. Network baseline

### 14.1 Active LAN interface

Observed interface:

```text
wlp27s0
```

Addresses observed:

```text
192.168.1.21/24      static/manual-looking, valid_lft forever
192.168.1.156/24     secondary dynamic DHCP address
```

Default route:

```text
default via 192.168.1.1 dev wlp27s0 proto static
default via 192.168.1.1 dev wlp27s0 proto dhcp src 192.168.1.156 metric 600
```

Outbound source address check:

```text
1.1.1.1 via 192.168.1.1 dev wlp27s0 src 192.168.1.21 uid 1000
```

### 14.2 Important exposed service

Portainer:

```text
https://192.168.1.21:9443
```

No public internet exposure was configured. Do not create router port forwarding for Portainer unless there is a deliberate security design.

### 14.3 Check listening Docker ports

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -tulpn | grep -Ei 'docker|9443|7860|11434' || true
```

---

## 15. Current image and disk footprint observations

Before Portainer was installed, `docker system df` showed:

```text
TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE
Images          3         0         13.44GB   13.44GB (99%)
Containers      0         0         0B        0B
Local Volumes   0         0         0B        0B
Build Cache     11        0         12.61GB   24.58kB
```

After Portainer installation, there is at least one running container and one named volume:

```text
container: portainer
volume:    portainer_data
```

Run this command for the current live state:

```bash
docker system df
docker ps
docker volume ls
```

Do not prune images or volumes casually. The PyTorch image build is large but useful to keep because rebuilding it took substantial time.

---

## 16. Baseline package list of interest

Captured in the host manifest:

```text
containerd.io                  2.2.5-1~ubuntu.26.04~resolute
docker-buildx-plugin           0.34.1-1~ubuntu.26.04~resolute
docker-ce                      5:29.6.0-1~ubuntu.26.04~resolute
docker-ce-cli                  5:29.6.0-1~ubuntu.26.04~resolute
docker-compose-plugin          5.1.4-1~ubuntu.26.04~resolute
nvidia-container-toolkit       1.19.1-1
nvidia-driver-595
nvidia-driver-595-open         595.71.05-0ubuntu0.26.04.1
nvidia-driver-binary
```

Other installed utility packages from setup include:

- `ubuntu-drivers-common`
- `linux-headers-$(uname -r)`
- `ca-certificates`
- `curl`
- `gnupg`
- `lsb-release`
- `git`
- `git-lfs`
- `jq`
- `htop`
- `nvtop`
- `unzip`
- `btop`

---

## 17. Standard project pattern for future AI services

Each important AI service should have one project folder under:

```text
/home/astigmatism/ai/experiments/<project-slug>
```

Recommended project structure:

```text
<project-slug>/
  README.md
  compose.yaml
  Dockerfile
  .env
  .dockerignore
  requirements.txt or pyproject.toml
  app/ or src/
```

Recommended `.env` pattern:

```dotenv
PROJECT_SLUG=my-service
AI_ROOT=/home/astigmatism/ai
WEB_BIND_IP=127.0.0.1
WEB_PORT=7860
GPU_DEVICE_ID=GPU-REPLACE-WITH-FULL-NVIDIA-UUID
```

Recommended GPU reservation pattern:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          device_ids:
            - "${GPU_DEVICE_ID}"
          capabilities: [gpu]
```

Do not set both `count` and `device_ids` in the same GPU reservation.

Recommended volume pattern:

```yaml
volumes:
  - ${AI_ROOT}/models:/models
  - ${AI_ROOT}/datasets:/datasets:ro
  - ${AI_ROOT}/outputs/${PROJECT_SLUG}:/outputs
  - ${AI_ROOT}/cache:/cache
```

Recommended web UI binding default:

```yaml
ports:
  - "127.0.0.1:${WEB_PORT}:7860"
```

If exposing a service to the LAN intentionally, bind it to a specific LAN IP:

```yaml
ports:
  - "192.168.1.21:${WEB_PORT}:7860"
```

Avoid `0.0.0.0` unless the exposure is deliberate and understood.

---

## 18. Adding GPUs in the future

The machine currently has two NVIDIA GPUs and may eventually have four. Adding GPUs should be treated as a hardware and software validation event.

### 18.1 Before adding a GPU

Checklist:

1. Confirm PSU capacity and available dedicated PCIe power cables.
2. Confirm physical slot availability and airflow.
3. Confirm case clearance.
4. Confirm motherboard/BIOS supports the intended number of GPUs.
5. Consider enabling BIOS settings commonly needed for multi-GPU systems, such as Above 4G Decoding, if required by the motherboard.
6. Do not mix NVIDIA driver installation sources.
7. Prefer Ubuntu-packaged NVIDIA drivers unless deliberately troubleshooting.
8. Record current state before changing hardware:

```bash
nvidia-smi -L
nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total,driver_version --format=csv
lspci | grep -Ei 'nvidia|vga|3d' || true
docker ps
```

### 18.2 Physical addition procedure

1. Stop important running workloads:

```bash
docker ps
# Stop project containers intentionally from their project folders, for example:
# cd /home/astigmatism/ai/experiments/<project>
# docker compose down
```

2. Shut down the host:

```bash
sudo shutdown now
```

3. Power off and unplug the machine.
4. Install the new GPU and required power connectors.
5. Verify cables and airflow.
6. Boot the machine.

### 18.3 After adding a GPU

Run:

```bash
lspci | grep -Ei 'nvidia|vga|3d' || true
nvidia-smi
nvidia-smi -L
```

Record a new inventory:

```bash
set -euo pipefail

mkdir -p "$HOME/apps/docker-management/manifests"
manifest="$HOME/apps/docker-management/manifests/gpu-inventory-$(date +%F-%H%M%S).csv"

nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total,driver_version --format=csv | tee "$manifest"

echo "Wrote $manifest"
```

Update:

```text
/home/astigmatism/apps/docker-management/manifests/gpu-map.md
```

Then rerun the Compose GPU assignment smoke test:

```bash
cd "$HOME/apps/docker-management/gpu-compose-test"
docker compose config
docker compose run --rm all-gpus
docker compose run --rm one-gpu-by-count
# Update GPU_TEST_DEVICE in .env if testing the new GPU specifically.
docker compose run --rm one-gpu-by-id
docker compose down
```

### 18.4 Updating existing services after adding GPUs

Services pinned to existing GPU UUIDs should continue to target the same physical cards as long as those cards remain installed.

However:

- Services using `count: 1` may be assigned differently.
- Services using `count: all` will now see additional GPUs.
- New services should use the new GPU UUID in `.env`.
- Update README files and GPU map notes after assigning intended uses.

---

## 19. Removing GPUs

Removing a GPU can break Compose services if their `.env` files reference the removed GPU UUID.

### 19.1 Before removing a GPU

Identify services that reference the GPU UUID:

```bash
grep -R "GPU-" "$HOME/ai/experiments" "$HOME/apps/docker-management" 2>/dev/null || true
```

Stop workloads that may be using the GPU:

```bash
nvidia-smi
docker ps
```

Stop relevant Compose projects from their project folders:

```bash
cd /home/astigmatism/ai/experiments/<project>
docker compose down
```

Record the current GPU inventory before physical removal:

```bash
nvidia-smi -L
nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total,driver_version --format=csv
```

### 19.2 Physical removal procedure

1. Shut down:

```bash
sudo shutdown now
```

2. Power off and unplug the machine.
3. Remove the GPU.
4. Verify remaining GPU power and slot connections.
5. Boot the machine.

### 19.3 After removing a GPU

Run:

```bash
lspci | grep -Ei 'nvidia|vga|3d' || true
nvidia-smi
nvidia-smi -L
```

Record a new inventory manifest:

```bash
set -euo pipefail

mkdir -p "$HOME/apps/docker-management/manifests"
manifest="$HOME/apps/docker-management/manifests/gpu-inventory-$(date +%F-%H%M%S).csv"

nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total,driver_version --format=csv | tee "$manifest"

echo "Wrote $manifest"
```

Update:

```text
/home/astigmatism/apps/docker-management/manifests/gpu-map.md
```

Search for stale UUID references:

```bash
grep -R "GPU-REMOVED-UUID-HERE" "$HOME/ai/experiments" "$HOME/apps/docker-management" 2>/dev/null || true
```

Rerun GPU Compose tests before restarting AI services.

---

## 20. Replacing a GPU

Replacing a GPU is a remove plus add operation. The new card will have a new UUID. Any `.env` references to the old UUID must be updated.

Recommended process:

1. Record old inventory.
2. Stop relevant workloads.
3. Shut down.
4. Replace hardware.
5. Boot.
6. Record new inventory.
7. Update `gpu-map.md`.
8. Update `.env` files that referenced the old UUID.
9. Run `docker compose config` in every affected project.
10. Run a GPU smoke test.
11. Start services intentionally.

Do not assume GPU index numbers remain stable after replacement.

---

## 21. Standard validation commands for future AI assistants

When a future AI assistant needs to understand this host, start with read-only checks:

```bash
set -euo pipefail

echo "# OS"
lsb_release -a || cat /etc/os-release
uname -a

echo

echo "# GPU"
nvidia-smi
nvidia-smi -L

echo

echo "# Docker"
docker version
docker compose version
docker info | grep -Ei 'Server Version|Storage Driver|Logging Driver|Cgroup Driver|Runtimes|Default Runtime|Docker Root Dir' || true

echo

echo "# GPU from container"
docker run --rm --gpus all nvidia/cuda:13.3.0-base-ubuntu26.04 nvidia-smi

echo

echo "# Key services"
systemctl status btop-dashboard@tty1.service --no-pager | sed -n '1,18p' || true
systemctl status getty@tty2.service --no-pager | sed -n '1,12p' || true
cd "$HOME/apps/docker-management/portainer" && docker compose ps || true
```

---

## 22. Troubleshooting notes

### 22.1 `ubuntu-drivers devices` prints `aplay command not found`

This happened on the minimal install and was benign. Driver discovery still worked. It appears related to missing audio tooling on a minimal system.

### 22.2 Host `nvidia-smi` fails

Possible causes:

- Driver package issue
- Kernel module load issue
- Secure Boot or MOK issue, though Secure Boot was disabled at baseline
- Kernel/header mismatch after updates
- Nouveau interference

Useful commands:

```bash
mokutil --sb-state || true
lsmod | grep -Ei 'nvidia|nouveau' || true
dmesg | grep -Ei 'nvidia|nouveau|secure|mok' | tail -200 || true
ubuntu-drivers devices
apt-cache policy 'nvidia-driver-*' | sed -n '1,120p'
```

### 22.3 Docker GPU access fails but host `nvidia-smi` works

Useful commands:

```bash
nvidia-ctk --version || true
docker info | grep -Ei 'Runtimes|Default Runtime' || true
cat /etc/docker/daemon.json | jq . || cat /etc/docker/daemon.json
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
docker run --rm --gpus all nvidia/cuda:13.3.0-base-ubuntu26.04 nvidia-smi
```

Restart affected GPU containers after Docker or NVIDIA runtime changes.

### 22.4 Compose GPU reservation errors

Check for:

- Missing `capabilities: [gpu]`
- Both `count` and `device_ids` set in the same reservation
- Wrong indentation
- UUID copied incorrectly
- `.env` not in the project directory
- Running Compose from the wrong folder

Validate with:

```bash
docker compose config
nvidia-smi -L
```

### 22.5 Portainer is not reachable

Check:

```bash
cd "$HOME/apps/docker-management/portainer"
docker compose ps
docker compose logs --tail=100 portainer
docker ps --filter "name=portainer" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
ip -4 -br addr show scope global
curl -k -I https://192.168.1.21:9443 | head -n 5
```

Use `https://`, not `http://`.

### 22.6 Local dashboard is not visible after reboot

Check:

```bash
systemctl status btop-dashboard@tty1.service --no-pager
journalctl -u btop-dashboard@tty1.service -n 50 --no-pager
pgrep -a btop || true
```

To restore normal TTY1 login:

```bash
sudo systemctl disable --now btop-dashboard@tty1.service
sudo systemctl enable --now getty@tty1.service
```

---

## 23. Security notes

### 23.1 Docker group

The user `astigmatism` is in the `docker` group. This is convenient but highly privileged. Treat this as effectively root-equivalent host access.

### 23.2 Portainer

Portainer has the Docker socket mounted. Anyone with Portainer admin access can control Docker on the host. Keep the admin password strong and do not expose Portainer to the public internet.

### 23.3 Secrets

Do not place tokens or secrets in:

- Dockerfiles
- Git repositories
- Image layers
- Docker image labels
- Shell history
- Committed `.env` files
- Command-line arguments visible in process lists

Preferred local secret patterns:

- `.env` files with mode `600`
- Files under `/home/astigmatism/ai/secrets` with restrictive permissions
- Docker Compose `env_file`
- A proper secret manager if the host becomes production-like

### 23.4 AI web UIs

Many AI web UIs are not safe to expose broadly. Prefer:

```yaml
ports:
  - "127.0.0.1:7860:7860"
```

Use a specific LAN IP only when the exposure is intentional:

```yaml
ports:
  - "192.168.1.21:7860:7860"
```

Never assume a local AI web UI has strong authentication or safe filesystem boundaries.

---

## 24. Backup recommendations

### 24.1 Back up AI state

Important paths:

```text
/home/astigmatism/ai/experiments
/home/astigmatism/ai/models
/home/astigmatism/ai/datasets
/home/astigmatism/ai/outputs
/home/astigmatism/ai/manifests
/home/astigmatism/apps/docker-management
```

Potential backup command pattern:

```bash
sudo rsync -aH --info=progress2 /home/astigmatism/ai/ /backup/ai/
sudo rsync -aH --info=progress2 /home/astigmatism/apps/docker-management/ /backup/docker-management/
```

Adjust `/backup/...` to a real backup target.

### 24.2 Back up Docker volumes selectively

Do not rely only on Docker images. Back up persistent data and project definitions.

Current named volume of note:

```text
portainer_data
```

Back it up using the Portainer backup command in section 12.10.

---

## 25. Known current limitations and intentional gaps

- The Portainer initial admin account status was not captured in the terminal transcript. Portainer was deployed and the HTTPS endpoint returned `HTTP/1.1 200 OK`.
- Portainer uses its default self-signed certificate.
- No reverse proxy has been configured.
- No firewall policy was explicitly configured during this setup.
- No router port forwarding should exist for Portainer.
- The local dashboard does not yet behave like a true screensaver dismissed by any keypress.
- No host-level CUDA toolkit was installed, intentionally.
- No global Conda or AI Python environment was installed, intentionally.
- No production-grade secret manager was configured.
- No additional GPUs beyond the current RTX 4080 SUPER and RTX 3090 have been installed yet.

---

## 26. Baseline ready criteria

At this baseline point, the host is considered ready for Docker-based AI experimentation because:

1. Ubuntu is installed and updated.
2. NVIDIA driver is installed and `nvidia-smi` works.
3. Both installed NVIDIA GPUs are visible.
4. Docker Engine works.
5. Docker Compose works.
6. Docker log rotation is configured.
7. NVIDIA Container Toolkit is installed.
8. Docker containers can access all GPUs.
9. Docker Compose can access all GPUs, one arbitrary GPU, and one UUID-selected GPU.
10. GPU UUID inventory is recorded.
11. GPU map exists.
12. `/home/astigmatism/ai` workspace exists.
13. PyTorch CUDA smoke test succeeded.
14. Portainer is running and reachable on the LAN via HTTPS.
15. Local display defaults to a `btop` dashboard on TTY1.
16. Normal console administration remains available on TTY2.

---

## 27. Quick reference

### Access Portainer

```text
https://192.168.1.21:9443
```

### Check GPUs

```bash
nvidia-smi
nvidia-smi -L
```

### Check Docker

```bash
docker ps
docker system df
docker compose version
```

### Check Docker GPU access

```bash
docker run --rm --gpus all nvidia/cuda:13.3.0-base-ubuntu26.04 nvidia-smi
```

### Check Portainer

```bash
cd /home/astigmatism/apps/docker-management/portainer
docker compose ps
docker compose logs --tail=100 portainer
```

### Check local dashboard

```bash
systemctl status btop-dashboard@tty1.service --no-pager
systemctl status getty@tty2.service --no-pager
```

### Main workspaces

```text
/home/astigmatism/ai
/home/astigmatism/apps/docker-management
```

### GPU UUIDs

```text
RTX 4080 SUPER: GPU-e4252fcb-8ed4-ef11-71cd-d36a23871c75
RTX 3090:       GPU-358353dd-5933-1dc6-ac0d-e1189b063e4c
```

---

## 28. Future AI assistant instructions

When helping with this machine in the future:

1. Do not assume `/srv/ai`; this host uses `/home/astigmatism/ai`.
2. Do not install host-level CUDA or Conda unless explicitly requested.
3. Do not install the old `docker-compose` v1 binary.
4. Use `docker compose` with a space.
5. Use GPU UUIDs for repeatable GPU assignment.
6. Do not use both `count` and `device_ids` in the same Compose GPU reservation.
7. Keep AI service definitions in Compose project folders.
8. Treat Portainer as a convenience UI, not the canonical configuration record.
9. Avoid destructive Docker prune commands unless explicitly approved.
10. Avoid exposing AI web UIs or Portainer to the public internet.
11. Bind LAN-exposed services to a specific LAN IP, preferably `192.168.1.21` while it remains valid.
12. Keep secrets out of Dockerfiles, image layers, committed files, and shell history.
13. Before changing GPU hardware, record current GPU UUIDs and stop relevant workloads.
14. After changing GPU hardware, regenerate inventory, update `gpu-map.md`, and rerun the GPU Compose smoke test.
15. Be explicit when a fact is verified versus assumed.
---
## 29. Runtime deployment pattern for GPU-assigned AI containers

### 29.1 Purpose and correction

This section records the runtime deployment contract for Dockerized local AI services that need GPU assignment, model selection, and repeatable startup behavior.

This version intentionally corrects the earlier draft pattern that allowed GPU marketing names or numeric GPU indices, such as `3090`, `4080-super`, `RTX 3090`, `0`, or `1`, as deployment inputs.

The canonical scheduler/deployment contract is now:

- Discovery may show GPU index, GPU name, bus ID, memory, and UUID for human readability.
- Deployment inputs must use NVIDIA GPU device IDs only, using the full `GPU-...` UUID reported by `nvidia-smi`.
- Generated runtime files must store GPU device IDs only.
- Deployment scripts must validate requested GPU device IDs against the live host inventory before changing `.env`, generated Compose overrides, or running containers.
- Deployment scripts must not resolve marketing names or numeric indices into GPU assignments as part of the canonical contract.

Friendly names, GPU model names, and physical-card labels are useful inventory metadata. They are not stable deployment API values.

The long-term direction remains a scheduler/deployment application that can show active containers, show available GPUs, select runtime models, assign GPU slots, and then call project-owned deployment scripts with explicit GPU device IDs.

### 29.2 Terminology

Use the following terms consistently across future AI services:

| Term | Meaning |
|---|---|
| GPU device ID | The full NVIDIA GPU UUID, for example `GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. |
| GPU slot | A service-declared assignment position that must receive one GPU device ID at runtime. |
| Slot count | The number of GPU slots assigned for a specific deployment. |
| Model asset | The service-specific model selection, such as a ComfyUI checkpoint filename or an Ollama model name. |
| Runtime state | Generated deployment state, normally `.env` and, where needed, a generated Compose override such as `compose.runtime.yaml`. |
| Stable service identity | Project name, container name, volume name, network name, and source folder that do not change just because GPUs or models change. |

### 29.3 Stable service identity, runtime-selected resources

Avoid creating a separate Compose project or container name for each GPU. A service should keep stable identity:

```text
container name: stable
Compose project name: stable
artifact/model volume name: stable
GPU assignment: runtime input using NVIDIA GPU device IDs
startup/default model: runtime input using service-specific model asset name
```

For `local-ai-images`, the current stable identity is:

```dotenv
LOCAL_AI_IMAGES_PROJECT_NAME=local-ai-images-legacy
LOCAL_AI_IMAGES_CONTAINER_NAME=local-ai-images-legacy
LOCAL_AI_IMAGES_ARTIFACTS_VOLUME_NAME=local-ai-images-legacy_artifacts
```

The dynamic runtime assignment for `local-ai-images` is one GPU slot:

```dotenv
GPU_DEVICE_ID=<NVIDIA GPU UUID>
IMAGE_DEFAULT_MODEL=<selected checkpoint filename>
```

For `local-ai-llm`, the stable identity should be independent of selected GPUs and model. The dynamic runtime assignment is multi-slot because the LLM runtime can use more than one GPU:

```dotenv
GPU_SLOT_COUNT=<1-4>
GPU_SLOT_0=<NVIDIA GPU UUID>
GPU_SLOT_1=<optional NVIDIA GPU UUID>
GPU_SLOT_2=<optional NVIDIA GPU UUID>
GPU_SLOT_3=<optional NVIDIA GPU UUID>
GPU_DEVICE_IDS=<comma-separated NVIDIA GPU UUIDs>
CUDA_VISIBLE_DEVICES=<comma-separated NVIDIA GPU UUIDs>
DEFAULT_MODEL=<selected Ollama model name>
```

For a two-service LLM Compose project, the `ollama` service is the schedulable GPU workload. The app/portal service may need to see the same GPUs for telemetry, but it should not be treated as a separate GPU-consuming workload by the scheduler.

### 29.4 Resource discovery before deployment

Discovery must happen before deployment, either by a human operator or by the future scheduler application.

Before deploying any GPU-bound container, discover available GPUs from the host:

```bash
nvidia-smi --query-gpu=index,uuid,name,pci.bus_id,memory.total,driver_version --format=csv
```

A scheduler may display index, name, bus ID, memory, and driver version for operator clarity. However, when it calls `deploy-runtime.sh`, it must pass only the selected `GPU-...` device IDs.

A deployment script should validate the requested IDs by querying:

```bash
nvidia-smi --query-gpu=uuid --format=csv,noheader
```

If any requested GPU device ID is missing, duplicated, malformed, or outside the service's allowed slot count, deployment must stop before changing runtime files or recreating containers. The script must not fall back to matching by GPU name, memory size, numeric index, or previous physical-card role.

For `local-ai-images`, selectable model assets are checkpoint files in:

```text
/home/astigmatism/ai/models/checkpoints
```

Equivalent container path:

```text
/models/checkpoints
```

Discovery command pattern:

```bash
find /home/astigmatism/ai/models/checkpoints -maxdepth 1 -type f \
  \( -name '*.safetensors' -o -name '*.ckpt' \) \
  -printf '%f\n' | sort
```

For `local-ai-llm`, selectable model assets are Ollama model names. The runtime may pull a requested model if it is not already present, but the scheduler should eventually maintain model metadata separately from image checkpoint metadata. Loose `.gguf` and `Modelfile` discovery can be added later when the shared LLM model folder layout is intentionally defined.

### 29.5 Canonical deployment script interface

Every service using this runtime deployment pattern should expose the same high-level command shape:

```bash
./deploy-runtime.sh list
./deploy-runtime.sh plan --gpu-device-ids <gpu-id-list> --model <model-asset>
./deploy-runtime.sh deploy --gpu-device-ids <gpu-id-list> --model <model-asset>
./deploy-runtime.sh <gpu-id-list> <model-asset>
./deploy-runtime.sh help
```

`<gpu-id-list>` is either one NVIDIA GPU UUID or a comma-separated list of NVIDIA GPU UUIDs:

```text
GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
```

The positional shorthand:

```bash
./deploy-runtime.sh <gpu-id-list> <model-asset>
```

is equivalent to:

```bash
./deploy-runtime.sh deploy --gpu-device-ids <gpu-id-list> --model <model-asset>
```

The following are not valid canonical deployment inputs:

```text
0
1
all
3090
4080
4080-super
RTX 3090
NVIDIA GeForce RTX 3090
```

If an operator wants to deploy to all currently installed GPUs, the scheduler or operator must first discover the current GPU UUIDs and then pass the explicit comma-separated UUID list. This keeps the deployment deterministic and makes the active runtime state auditable.

#### `list`

`list` is read-only. It should show:

- Current GPUs discovered from `nvidia-smi`, including UUIDs.
- Service-specific selectable model assets, such as image checkpoints or known/current Ollama models.
- Current active runtime state, if `.env` exists.

Future scheduler support may add:

```bash
./deploy-runtime.sh list --json
```

#### `plan`

`plan` is read-only. It should:

1. Parse and validate the requested GPU device IDs.
2. Validate slot count against the service contract.
3. Validate or describe the requested model asset.
4. Print the generated runtime state that would be written.
5. Print the Compose files that would be used.
6. Print any expected persistent volumes or bind mounts.
7. Exit without changing `.env`, generated Compose overrides, Docker volumes, images, or containers.

Future scheduler support may add:

```bash
./deploy-runtime.sh plan --gpu-device-ids <ids> --model <asset> --json
```

#### `deploy`

`deploy` performs the same validation as `plan`, then applies the runtime state and recreates the relevant Compose services.

### 29.6 Generated runtime `.env` contract

A runtime deployment script should generate `.env` from validated inputs and stable defaults. Operators should not hand-edit GPU/model assignment in `.env` for routine deployments.

Generated files should begin with a warning similar to:

```dotenv
# Generated by deploy-runtime.sh
# Do not edit GPU/model assignment here by hand; rerun deploy-runtime.sh.
```

#### Single-slot image generation example

Recommended generated `.env` fields for `local-ai-images`:

```dotenv
LOCAL_AI_IMAGES_PROJECT_NAME=local-ai-images-legacy
LOCAL_AI_IMAGES_CONTAINER_NAME=local-ai-images-legacy
LOCAL_AI_IMAGES_ARTIFACTS_VOLUME_NAME=local-ai-images-legacy_artifacts
LOCAL_AI_IMAGES_IMAGE=local-ai-images-legacy:local

AI_ROOT=/home/astigmatism/ai
WEB_BIND_IP=192.168.1.21
WEB_PORT=8000

GPU_DEVICE_ID=GPU-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

IMAGE_GENERATION_ENABLED=true
IMAGE_BACKEND=comfyui
COMFYUI_BASE_URL=http://host.docker.internal:8188

REQUIRE_IMAGE_API_AUTH=false
IMAGE_API_KEYS=

IMAGE_DEFAULT_WORKFLOW_ID=sdxl-text-to-image
IMAGE_DEFAULT_MODEL=<selected checkpoint filename>
IMAGE_PRELOAD_DEFAULT_ON_STARTUP=false
IMAGE_PRELOAD_TIMEOUT_MS=120000
IMAGE_PRELOAD_WORKFLOW_ID=sdxl-text-to-image
IMAGE_PRELOAD_WIDTH=512
IMAGE_PRELOAD_HEIGHT=512
IMAGE_PRELOAD_STEPS=1
IMAGE_PRELOAD_KEEP_ARTIFACT=false
IMAGE_QUEUE_CONCURRENCY=1
IMAGE_MAX_QUEUED_JOBS=32

MODEL_INSTALLS_ENABLED=false
MODEL_INSTALL_ALLOW_CKPT=false
LEGACY_OLLAMA_ENABLED=false
```

The image-generation runtime script should set `IMAGE_PRELOAD_DEFAULT_ON_STARTUP=false` when it plans to explicitly call the preload API after the service is healthy. This avoids a race where startup preload and manual preload collide.

#### Multi-slot LLM example

Recommended generated `.env` fields for a containerized `local-ai-llm` deployment:

```dotenv
LOCAL_AI_LLM_PROJECT_NAME=local-ai-llm
LOCAL_AI_LLM_APP_CONTAINER_NAME=local-ai-llm-app
LOCAL_AI_LLM_OLLAMA_CONTAINER_NAME=local-ai-llm-ollama
LOCAL_AI_LLM_IMAGE=local-ai-llm:local
OLLAMA_IMAGE=ollama/ollama:latest

AI_ROOT=/home/astigmatism/ai
WEB_BIND_IP=192.168.1.21
WEB_PORT=8001

OLLAMA_MODELS_PATH=/home/astigmatism/ai/models/ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_REQUEST_TIMEOUT_MS=1200000

GPU_SLOT_COUNT=2
GPU_SLOT_0=GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
GPU_SLOT_1=GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
GPU_SLOT_2=
GPU_SLOT_3=
GPU_DEVICE_IDS=GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
CUDA_VISIBLE_DEVICES=GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb

DEFAULT_MODEL=<selected Ollama model name>
PREWARM_DEFAULT_MODEL_ON_START=false
```

For multi-GPU services, a generated Compose override such as `compose.runtime.yaml` may be required because Docker Compose GPU `device_ids` are a YAML list, not a comma-separated scalar. The base `compose.yaml` should remain stable and declare service structure; generated runtime overrides should contain the current GPU device list only.

### 29.7 Compose labels should describe schedulable resource contracts

Compose labels should expose enough metadata for a future scheduler UI or inspection tool to understand the service contract. Labels should describe the contract; they should not assign a GPU by themselves.

For a one-GPU-slot image generation service:

```yaml
labels:
  local-ai.managed: "true"
  local-ai.service.name: "local-ai-images"
  local-ai.gpu.slots.min: "1"
  local-ai.gpu.slots.max: "1"
  local-ai.gpu.slots.default: "1"
  local-ai.gpu.slot.0.assignment.env: "GPU_DEVICE_ID"
  local-ai.gpu.slot.0.assignment.kind: "nvidia-gpu-uuid"
  local-ai.model.default.env: "IMAGE_DEFAULT_MODEL"
  local-ai.model.preload.env: "IMAGE_PRELOAD_DEFAULT_ON_STARTUP"
  local-ai.model.workflow.env: "IMAGE_DEFAULT_WORKFLOW_ID"
  local-ai.model.checkpoints.container_path: "/models/checkpoints"
  local-ai.model.checkpoints.host_path: "${AI_ROOT:-/home/astigmatism/ai}/models/checkpoints"
  local-ai.runtime.env_file: ".env"
```

For a multi-GPU-slot LLM runtime service:

```yaml
labels:
  local-ai.managed: "true"
  local-ai.service.name: "local-ai-llm"
  local-ai.service.role: "model-runtime"
  local-ai.gpu.slots.min: "1"
  local-ai.gpu.slots.max: "4"
  local-ai.gpu.slots.default: "1"
  local-ai.gpu.assignment.env: "GPU_DEVICE_IDS"
  local-ai.gpu.assignment.kind: "nvidia-gpu-uuid-list"
  local-ai.gpu.cuda_visible_devices.env: "CUDA_VISIBLE_DEVICES"
  local-ai.model.default.env: "DEFAULT_MODEL"
  local-ai.model.runtime: "ollama"
  local-ai.model.store.container_path: "/root/.ollama"
  local-ai.model.store.host_path: "${OLLAMA_MODELS_PATH:-/home/astigmatism/ai/models/ollama}"
  local-ai.runtime.env_file: ".env"
  local-ai.runtime.compose_override: "compose.runtime.yaml"
```

For a companion app/portal service in the same project:

```yaml
labels:
  local-ai.managed: "true"
  local-ai.service.name: "local-ai-llm"
  local-ai.service.role: "portal"
  local-ai.gpu.slots.min: "0"
  local-ai.gpu.slots.max: "0"
  local-ai.runtime.env_file: ".env"
```

If the portal receives GPU visibility only for telemetry, the scheduler should still treat the model-runtime service as the GPU-owning workload.

### 29.8 Expected deployment behavior

A deployment script using this contract should perform the following high-level behavior:

1. Read service defaults and existing `.env` values where appropriate.
2. Discover live GPU UUIDs from `nvidia-smi`.
3. Validate every requested GPU device ID exactly.
4. Reject malformed, missing, duplicate, or unsupported GPU device IDs.
5. Validate slot count against the service's declared min/max.
6. Discover or validate service-specific model assets.
7. In `plan` mode, print the resolved runtime state and exit without changing anything.
8. In `deploy` mode, generate `.env` and any required Compose runtime override.
9. Ensure required persistent host directories or Docker volumes exist.
10. Render and validate Compose configuration.
11. Recreate only the relevant Compose service or services.
12. Wait for container health.
13. Set or verify the selected default model through the app/runtime API when supported.
14. Optionally prewarm/preload the selected model.
15. Print final container status and visible GPU UUIDs from inside the container.

### 29.9 Deployment script should tolerate asynchronous model loading

Model loading can be asynchronous. A script should not treat a transient busy response as a hard deployment failure without checking current state.

For `local-ai-images`, recommended preload behavior remains:

1. Check `/health` after container readiness.
2. If the selected checkpoint is already confirmed loaded, exit successfully.
3. If preload is currently active, poll `/health` until it succeeds, fails, or times out.
4. If calling `/api/v1/models/preload` returns a busy/conflict response, treat it as busy and poll `/health`.
5. If the selected checkpoint becomes `lastConfirmedLoadedModel`, report success.
6. If preload fails, surface the application error and stop.

For `local-ai-llm`, recommended model behavior is:

1. Start the Ollama runtime service with the selected GPU device IDs.
2. Wait for the Ollama API to become reachable from the app network.
3. Pull the requested model if the deployment policy allows missing models to be installed at deploy time.
4. Set the app default model through the app API or generated config.
5. Optionally prewarm the selected model.
6. Report whether the model is loaded and which GPUs are visible to the runtime.

### 29.10 Separate app-source updates from runtime assignments

There are two separate operations:

#### Fast application source update

Use when code changed but the runtime image stack did not change:

```bash
bash ./update-and-restart.sh
```

Expected behavior:

- Pull latest Git changes.
- Skip Docker image build when the app source is bind-mounted into the container.
- Recreate the container or relevant Compose services.
- Wait for health.

#### Runtime GPU/model assignment

Use when the service should run with selected GPU device IDs and a selected startup/default model:

```bash
bash ./deploy-runtime.sh deploy --gpu-device-ids <gpu-id-list> --model <model-asset>
```

Expected behavior:

- Generate runtime state from validated GPU device IDs and model input.
- Recreate the relevant Compose service or services.
- Set and optionally preload/prewarm the selected model.

#### Full image rebuild

Use only when image-level dependencies or runtime stack files change, such as:

- `Dockerfile`
- `docker-entrypoint.sh`
- `package.json`
- `package-lock.json`
- Python/ComfyUI/PyTorch/Ollama-adjacent runtime dependencies

Command pattern:

```bash
FULL_REBUILD=true bash ./update-and-restart.sh
```

Normal app source edits should not require a Docker image rebuild when source is bind-mounted into the container.

### 29.11 Compose source mount pattern for fast app updates

For local-development-style deployment on this host, application source can be bind-mounted into a stable runtime image. This avoids rebuilding large runtime images for every TypeScript or public asset change.

Example pattern:

```yaml
volumes:
  - ./src:/app/src:ro
  - ./public:/app/public:ro
  - ./deploy:/app/deploy:ro
  - ./package.json:/app/package.json:ro
  - ./package-lock.json:/app/package-lock.json:ro
  - ./tsconfig.json:/app/tsconfig.json:ro
  - ./README.md:/app/README.md:ro
  - ./config:/app/config
  - ${AI_ROOT:-/home/astigmatism/ai}/models:/models
  - ${AI_ROOT:-/home/astigmatism/ai}/cache:/cache
```

This is appropriate for this local AI host because the Git checkout is intentionally present on the deployment machine. For a more production-like deployment later, image-based immutable deployments may be preferable.

### 29.12 Persistent state must remain outside disposable container layers

Runtime deployments should preserve generated content and model assets by keeping them in bind mounts or named volumes.

For `local-ai-images`, important persistent locations are:

```text
Models/checkpoints:
  /home/astigmatism/ai/models

Cache:
  /home/astigmatism/ai/cache

Generated artifacts:
  Docker volume: local-ai-images-legacy_artifacts
  Container path: /app/data/artifacts

Runtime app config/defaults/favorites:
  /home/astigmatism/apps/local-ai-images-legacy/config
```

For `local-ai-llm`, planned persistent locations are:

```text
Ollama model store:
  /home/astigmatism/ai/models/ollama
  Container path: /root/.ollama

Cache:
  /home/astigmatism/ai/cache

Runtime app config/defaults:
  /home/astigmatism/apps/local-ai-llm/config
```

A Docker container recreate should not delete those locations. Avoid `docker system prune -a --volumes` unless the data ownership and backup state are understood.

### 29.13 Future scheduler application direction

A future scheduler/deployment UI can build on this pattern by discovering:

- Active Docker containers and Compose projects.
- Compose labels beginning with `local-ai.*`.
- GPU inventory from `nvidia-smi`.
- GPU UUIDs currently assigned to each schedulable service.
- Container-to-GPU mappings from Docker inspect / NVIDIA runtime state.
- Model inventories from declared host model paths or runtime APIs.
- Exposed web ports and bind addresses from Compose config.
- Persistent volume names and mounted host paths.

The UI could then allow an operator to:

1. See available GPUs and currently assigned containers.
2. Select one or more GPU device IDs for a schedulable service.
3. Select a startup/default model from the service-specific model inventory.
4. Run a read-only plan operation.
5. Generate or update the service runtime state.
6. Recreate the selected Compose service or services.
7. Wait for health and display final assignment state.

The shell scripts are the current concrete implementation of that future scheduler contract. They should therefore remain scriptable and deterministic.

### 29.14 Rules for future services using this pattern

For each future Dockerized AI service:

1. Declare GPU slot requirements in Compose labels.
2. Use a stable project/container/volume name independent of selected GPUs.
3. Treat `.env` and generated Compose overrides as active runtime state.
4. Discover GPUs before assignment.
5. Pass only full NVIDIA GPU UUID device IDs to deployment scripts.
6. Do not pass GPU model names, friendly names, numeric indices, or `all` as deployment inputs.
7. Discover selectable runtime assets, such as checkpoints or Ollama models, before deployment.
8. Validate all requested GPU device IDs and model assets before recreating containers.
9. Keep persistent outputs, models, caches, and configs outside disposable container layers.
10. Separate fast app-source updates from full image rebuilds.
11. Keep deployment script behavior consistent across services even when service-specific slot counts differ.
12. Keep the deployment path scriptable first; a UI can later call the same primitives.

