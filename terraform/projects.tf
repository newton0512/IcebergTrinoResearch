resource "selectel_vpc_project_v2" "project" {
  name = "iceberg-${var.environment_name}"

  lifecycle {
    create_before_destroy = true
    ignore_changes        = [name]
  }
}

# IAM service-user для доступа к OpenStack API в рамках проекта
resource "selectel_iam_serviceuser_v1" "openstack" {
  name     = "iceberg-${var.environment_name}"
  password = var.selectel_openstack_password

  role {
    role_name  = "member"
    scope      = "project"
    project_id = selectel_vpc_project_v2.project.id
  }
}