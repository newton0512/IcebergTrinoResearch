resource "openstack_networking_port_v2" "ports" {
  count      = 2
  network_id = openstack_networking_network_v2.private_net.id

  fixed_ip {
    subnet_id = openstack_networking_subnet_v2.private_subnet.id
  }
}
