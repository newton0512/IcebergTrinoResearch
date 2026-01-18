terraform {
  required_providers {
    selectel = {
      source  = "selectel/selectel"
      version = "~> 7.1.0"
    }
    openstack = {
      source  = "terraform-provider-openstack/openstack"
      version = "~> 3.0"
    }
  }
}

provider "selectel" {
  domain_name = var.domain_name
  username    = var.iam_username
  password    = var.iam_password
  auth_region = var.auth_region
  auth_url    = "https://cloud.api.selcloud.ru/identity/v3/"
}

provider "openstack" {
  auth_url    = "https://cloud.api.selcloud.ru/identity/v3/"
  domain_name = var.domain_name
  user_name   = var.iam_username
  password    = var.iam_password
  region      = var.region
  tenant_id   = var.project_id
}