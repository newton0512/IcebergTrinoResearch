output "load_test_public_ip" {
  value       = openstack_networking_floatingip_v2.load.address
  description = "Публичный IP Load Test Server (единственный внешний IP)"
}

output "data_server_private_ip" {
  value       = openstack_compute_instance_v2.data.access_ip_v4
  description = "Приватный IP Data Server (доступен только из внутренней сети)"
}

output "load_test_private_ip" {
  value       = openstack_compute_instance_v2.load.access_ip_v4
  description = "Приватный IP Load Test Server"
}

output "ansible_load_public_ip" {
  value       = openstack_networking_floatingip_v2.load.address
  description = "Ansible: ansible_host для load_test_server (публичный IP)"
}

output "ansible_data_private_ip" {
  value       = openstack_compute_instance_v2.data.access_ip_v4
  description = "Ansible: ansible_host для data_server (приватный IP, доступ через ProxyJump)"
}

output "project_id" {
  value       = selectel_vpc_project_v2.project.id
  description = "Selectel VPC Project ID"
}
