#!/bin/bash
# Обновляет load_public_ip, data_private_ip, load_private_ip в ansible/inventory/group_vars/all.yml
# Запуск: из samples-generation/  →  ./scripts/refresh-inventory.sh
#        или  ./scripts/refresh-inventory.sh [terraform_dir] [ansible_dir]

set -e
TF_DIR="${1:-terraform}"
ANSIBLE_DIR="${2:-ansible}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOAD_PUBLIC=$(terraform -chdir="$TF_DIR" output -raw load_test_public_ip 2>/dev/null || true)
DATA_PRIVATE=$(terraform -chdir="$TF_DIR" output -raw data_server_private_ip 2>/dev/null || true)
LOAD_PRIVATE=$(terraform -chdir="$TF_DIR" output -raw load_test_private_ip 2>/dev/null || true)

if [ -z "$LOAD_PUBLIC" ] || [ -z "$DATA_PRIVATE" ]; then
  echo "Error: run 'terraform apply' first. Could not get load_test_public_ip or data_server_private_ip." >&2
  exit 1
fi

ALL="$ANSIBLE_DIR/inventory/group_vars/all.yml"
if [ ! -f "$ALL" ]; then
  echo "Error: $ALL not found." >&2
  exit 1
fi

sed -i.bak "s/^load_public_ip: .*/load_public_ip: \"${LOAD_PUBLIC}\"/" "$ALL"
sed -i.bak "s/^data_private_ip: .*/data_private_ip: \"${DATA_PRIVATE}\"/" "$ALL"
sed -i.bak "s/^load_private_ip: .*/load_private_ip: \"${LOAD_PRIVATE:-}\"/" "$ALL"
rm -f "${ALL}.bak"

echo "Updated load_public_ip, data_private_ip, load_private_ip in inventory/group_vars/all.yml"
