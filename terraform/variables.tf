variable "domain_name" {
  description = "Номер аккаунта Selectel"
  type        = string
}

variable "iam_username" {
  description = "Имя сервисного пользователя"
  type        = string
}

variable "iam_password" {
  description = "Пароль сервисного пользователя"
  type        = string
  sensitive   = true
}

variable "auth_region" {
  description = "Регион авторизации (например ru-9)"
  type        = string
}

variable "region" {
  description = "Регион создания ресурсов (например ru-9)"
  type        = string
}

variable "data_flavor_id" {
  description = "Flavor ID для Data Server"
  type        = string
}

variable "load_flavor_id" {
  description = "Flavor ID для Load Test Server"
  type        = string
}

variable "project_id" {
  description = "ID проекта Selectel (VPC Project)"
  type        = string
}

variable "service_user_id" {
  description = "ID сервисного пользователя"
  type        = string
}