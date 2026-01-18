output "data_server_public_ip" {
  value = openstack_networking_floatingip_v2.fips[0].address
  description = "Публичный IP Data Server"
}

# Если Load Test Server пока на том же IP
output "load_test_public_ip" {
  value = openstack_networking_floatingip_v2.fips[0].address
  description = "Публичный IP Load Test Server (совпадает с Data Server)"
}
