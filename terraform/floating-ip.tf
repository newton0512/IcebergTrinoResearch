resource "openstack_networking_floatingip_v2" "data" {
  pool = "external-network"
}

resource "openstack_networking_floatingip_v2" "load" {
  pool = "external-network"
}

resource "openstack_networking_floatingip_associate_v2" "data" {
  port_id     = openstack_networking_port_v2.data.id
  floating_ip = openstack_networking_floatingip_v2.data.address

  depends_on = [openstack_networking_router_interface_v2.router_if]
}

resource "openstack_networking_floatingip_associate_v2" "load" {
  port_id     = openstack_networking_port_v2.load.id
  floating_ip = openstack_networking_floatingip_v2.load.address

  depends_on = [openstack_networking_router_interface_v2.router_if]
}
