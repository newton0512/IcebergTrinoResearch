output "data_server_public_ip" {
  value       = openstack_networking_floatingip_v2.data.address
  description = "Публичный IP Data Server"
}

output "load_test_public_ip" {
  value       = openstack_networking_floatingip_v2.load.address
  description = "Публичный IP Load Test Server"
}

output "data_server_private_ip" {
  value       = openstack_compute_instance_v2.data.access_ip_v4
  description = "Приватный IP Data Server"
}

output "load_test_private_ip" {
  value       = openstack_compute_instance_v2.load.access_ip_v4
  description = "Приватный IP Load Test Server"
}

output "ssh_data_server" {
  value       = "ssh ubuntu@${openstack_networking_floatingip_v2.data.address}"
  description = "Команда SSH для подключения к Data Server"
}

output "ssh_load_test_server" {
  value       = "ssh ubuntu@${openstack_networking_floatingip_v2.load.address}"
  description = "Команда SSH для подключения к Load Test Server"
}

output "wait_for_data_server" {
  value       = "ssh ubuntu@${openstack_networking_floatingip_v2.data.address} 'while [ ! -f /root/cloud-init-ready-data ]; do echo \"Waiting for Data Server setup...\"; sleep 10; done; echo \"Data Server ready!\"'"
  description = "Команда для ожидания завершения cloud-init на Data Server"
}

output "wait_for_load_test_server" {
  value       = "ssh ubuntu@${openstack_networking_floatingip_v2.load.address} 'while [ ! -f /root/cloud-init-ready-load ]; do echo \"Waiting for Load Test Server setup...\"; sleep 10; done; echo \"Load Test Server ready!\"'"
  description = "Команда для ожидания завершения cloud-init на Load Test Server"
}

output "project_id" {
  value       = selectel_vpc_project_v2.project.id
  description = "Selectel VPC Project ID"
}
