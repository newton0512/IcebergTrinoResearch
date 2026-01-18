resource "openstack_networking_network_v2" "private_net" {
  name           = "private-network"
  admin_state_up = true
}

resource "openstack_networking_subnet_v2" "private_subnet" {
  name       = "private-subnet"
  network_id = openstack_networking_network_v2.private_net.id
  cidr       = var.private_subnet_cidr
}

data "openstack_networking_network_v2" "external_net" {
  external = true
}

resource "openstack_networking_router_v2" "router" {
  name                = "router"
  external_network_id = data.openstack_networking_network_v2.external_net.id
}

resource "openstack_networking_router_interface_v2" "router_if" {
  router_id = openstack_networking_router_v2.router.id
  subnet_id = openstack_networking_subnet_v2.private_subnet.id
}
