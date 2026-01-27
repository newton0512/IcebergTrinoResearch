resource "openstack_networking_secgroup_v2" "data" {
  name        = "iceberg-data-sg-${var.environment_name}"
  description = "Security group for Data Server (Trino/MinIO/Nessie/Postgres)"

  depends_on = [
    selectel_vpc_project_v2.project,
    selectel_iam_serviceuser_v1.openstack
  ]
}

resource "openstack_networking_secgroup_v2" "load" {
  name        = "iceberg-load-sg-${var.environment_name}"
  description = "Security group for Load Test Server (API/K6 runner)"

  depends_on = [
    selectel_vpc_project_v2.project,
    selectel_iam_serviceuser_v1.openstack
  ]
}

# -----------------------------
# Data Server rules
# -----------------------------

# Data Server SSH доступен только из внутренней сети (через Load Test Server)
resource "openstack_networking_secgroup_rule_v2" "data_ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

# Trino доступен только из внутренней сети (доступ извне через SSH портфорвардинг)
resource "openstack_networking_secgroup_rule_v2" "data_trino" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 8080
  port_range_max    = 8080
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

# MinIO API доступен только из внутренней сети (доступ извне через SSH портфорвардинг)
resource "openstack_networking_secgroup_rule_v2" "data_minio_api" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 9000
  port_range_max    = 9000
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

# MinIO Console доступен только из внутренней сети (доступ извне через SSH портфорвардинг)
resource "openstack_networking_secgroup_rule_v2" "data_minio_console" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 9001
  port_range_max    = 9001
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

resource "openstack_networking_secgroup_rule_v2" "data_nessie_internal" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 19120
  port_range_max    = 19120
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

resource "openstack_networking_secgroup_rule_v2" "data_postgres_internal" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 5432
  port_range_max    = 5432
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

resource "openstack_networking_secgroup_rule_v2" "data_internal_all" {
  direction         = "ingress"
  ethertype         = "IPv4"
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.data.id
}

# -----------------------------
# Load Test Server rules
# -----------------------------

resource "openstack_networking_secgroup_rule_v2" "load_ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = openstack_networking_secgroup_v2.load.id
}

resource "openstack_networking_secgroup_rule_v2" "load_api" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 3000
  port_range_max    = 3000
  remote_ip_prefix  = "0.0.0.0/0"
  security_group_id = openstack_networking_secgroup_v2.load.id
}

resource "openstack_networking_secgroup_rule_v2" "load_internal_all" {
  direction         = "ingress"
  ethertype         = "IPv4"
  remote_ip_prefix  = var.private_subnet_cidr
  security_group_id = openstack_networking_secgroup_v2.load.id
}
