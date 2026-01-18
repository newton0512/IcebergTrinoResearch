resource "openstack_networking_floatingip_v2" "fips" {
  count = 1
  pool  = "external-network"
}

resource "openstack_networking_floatingip_associate_v2" "assoc" {
  count       = 1
  port_id     = openstack_networking_port_v2.ports[count.index].id
  floating_ip = openstack_networking_floatingip_v2.fips[count.index].address
}
