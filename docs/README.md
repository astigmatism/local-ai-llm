# Documentation reading order

Follow these documents in order on a fresh Ubuntu 24 Server host.

1. [`01-ubuntu-24-server-baseline.md`](01-ubuntu-24-server-baseline.md) - OS baseline, SSH assumptions, updates, firewall, static IP, and time sync.
2. [`02-nvidia-driver-and-gpu-setup.md`](02-nvidia-driver-and-gpu-setup.md) - NVIDIA driver installation, `nvidia-smi`, multi-GPU verification, and troubleshooting for the RTX 3090 + RTX 4080 host.
3. [`03-ollama-installation-and-configuration.md`](03-ollama-installation-and-configuration.md) - Ollama installation, service configuration, port `11434`, model pulls, GPU verification, and multi-GPU behavior.
4. [`04-application-installation.md`](04-application-installation.md) - Node 24, repository clone, dependency install, tests, build, systemd service, and port `8000` checks.
5. [`05-model-management-and-default-models.md`](05-model-management-and-default-models.md) - Default model config, `/model/load`, pre-warming, and portal workflows.
6. [`06-security-and-networking.md`](06-security-and-networking.md) - LAN-only assumptions, firewall guidance, bind addresses, and authentication/reverse proxy recommendations.
7. [`07-operations-and-troubleshooting.md`](07-operations-and-troubleshooting.md) - Service status, logs, restarts, update/compression scripts, and compatibility validation.

Source references used while preparing these docs include the official Ubuntu Server NVIDIA driver guide, official Ollama Linux/API/GPU documentation, Node.js/NodeSource installation guidance, and NVIDIA `nvidia-smi` query documentation.
