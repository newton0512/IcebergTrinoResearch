# НЕ храните секреты в terraform.tfvars. Используйте переменные окружения TF_VAR_*.
#
# Пример:
#   export TF_VAR_selectel_domain="533343"
#   export TF_VAR_selectel_username="Newton"
#   export TF_VAR_selectel_password="***"
#   export TF_VAR_selectel_openstack_password="***"

environment_name  = "iceberg-test"
region            = "ru-9"
availability_zone = "ru-9a"
disk_type         = "fast"

# FLAVOR IDs (Selectel)
data_flavor_id = "1019" # 16 vCPU / 64GB
load_flavor_id = "2011" # 4 vCPU / 8GB

data_volume_size_gb = 300

# SSH public key path (local machine)
ssh_public_key_path = "~/.ssh/id_rsa_terraform.pub"