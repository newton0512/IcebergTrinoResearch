variable "environment_name" {
  description = "Суффикс для имен ресурсов (например dev/test)"
  type        = string
  default     = "iceberg-test"
}

variable "region" {
  description = "Регион Selectel (например ru-9)"
  type        = string
}

variable "availability_zone" {
  description = "AZ в регионе (например ru-9a)"
  type        = string
  default     = "ru-9a"
}

variable "disk_type" {
  description = "Тип диска Selectel (например fast/universal/basic/basic_hdd)"
  type        = string
  default     = "fast"
}

variable "private_subnet_cidr" {
  description = "CIDR приватной подсети"
  type        = string
  default     = "192.168.199.0/24"
}

variable "data_flavor_id" {
  description = "Flavor ID для Data Server"
  type        = string
}

variable "load_flavor_id" {
  description = "Flavor ID для Load Test Server"
  type        = string
}

variable "data_boot_disk_size_gb" {
  description = "Размер загрузочного диска Data Server (GB)"
  type        = number
  default     = 50
}

variable "load_boot_disk_size_gb" {
  description = "Размер загрузочного диска Load Test Server (GB)"
  type        = number
  default     = 50
}

variable "data_volume_size_gb" {
  description = "Размер data-тома для Data Server (GB) (MinIO/S3 + Postgres + Nessie). Монтируется в /data, туда же Ansible привязывает данные контейнеров."
  type        = number
  default     = 300
}

variable "data_volume_disk_type" {
  description = "Тип диска для data-тома (MinIO/S3, Postgres, Nessie). Отдельно от disk_type загрузочного диска. Например fast (NVMe) для максимальной скорости записи."
  type        = string
  default     = "fast"
}

variable "ssh_public_key_path" {
  description = "Путь к SSH public key на локальной машине (например ~/.ssh/id_ed25519.pub)"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "selectel_domain" {
  description = "Номер аккаунта Selectel (domain_name)"
  type        = string
}

variable "selectel_username" {
  description = "Логин Selectel (для Selectel provider)"
  type        = string
}

variable "selectel_password" {
  description = "Пароль Selectel (для Selectel provider)"
  type        = string
  sensitive   = true
}

variable "selectel_openstack_password" {
  description = "Пароль, который Terraform задаст IAM service-user'у (используется OpenStack provider)"
  type        = string
  sensitive   = true
}