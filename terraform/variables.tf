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
  description = "Размер data-тома для Data Server (GB) (MinIO + Postgres data + Nessie data)"
  type        = number
  default     = 300
}

variable "ssh_public_key_path" {
  description = "Путь к SSH public key на локальной машине (например ~/.ssh/id_ed25519.pub)"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "repo_url" {
  description = "URL публичного git-репозитория, который будет клонирован на ВМ"
  type        = string
  default     = "https://github.com/newton0512/IcebergTrinoResearch.git"
}

variable "repo_ref" {
  description = "Git ref (branch/tag/commit) для деплоя"
  type        = string
  default     = "terraform"
}

variable "repo_subdir" {
  description = "Подкаталог в репозитории, где лежит проект (samples-generation)"
  type        = string
  default     = "samples-generation"
}

variable "trino_heap_gb" {
  description = "Trino JVM heap (GB) для Data Server"
  type        = number
  default     = 48
}

variable "trino_max_direct_memory_gb" {
  description = "Trino MaxDirectMemorySize (GB)"
  type        = number
  default     = 8
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